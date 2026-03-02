use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("HbXhqEFevpkfYdZCN6YmJGRmQmj9vsBun2ZHjeeaLRik");

/// Native-SOL Perpetuals Market.
///
/// Collateral is deposited as lamports into the VaultState PDA itself
/// (no SPL token accounts needed). This mirrors how ETH/BNB are used
/// on the EVM chains: the native coin is the margin currency.
///
/// Decimal convention: all lamport amounts use 9 decimals (1 SOL = 1_000_000_000 lamports).
/// Prices are also stored with 9 implied decimals (same as Solana's native precision).
#[program]
pub mod gold_perps_market {
    use super::*;

    /// Initialize the global vault.
    /// skew_scale and funding_velocity control the market's price impact curve.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        skew_scale: u64,
        funding_velocity: u64,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.insurance_fund = 0;
        vault.skew_scale = skew_scale;
        vault.funding_velocity = funding_velocity;
        Ok(())
    }

    /// Push updated TrueSkill ratings from the Dueling system.
    /// Called by the keeper bot after each duel resolves.
    pub fn update_oracle(
        ctx: Context<UpdateOracle>,
        agent_id: u32,
        spot_index: u64,
        mu: u64,
        sigma: u64,
    ) -> Result<()> {
        let oracle = &mut ctx.accounts.oracle;
        let now = Clock::get()?.unix_timestamp;

        if oracle.agent_id == 0 {
            // First-time init
            oracle.agent_id = agent_id;
            oracle.total_long_oi = 0;
            oracle.total_short_oi = 0;
            oracle.current_funding_rate = 0;
        } else {
            // Drift funding based on skew since last update
            let vault = &ctx.accounts.vault;
            let time_delta = now - oracle.last_updated;
            if time_delta > 0 {
                let skew = oracle.total_long_oi as i64 - oracle.total_short_oi as i64;
                oracle.current_funding_rate += (skew
                    * vault.funding_velocity as i64
                    * time_delta)
                    / vault.skew_scale as i64;
            }
        }

        oracle.spot_index = spot_index;
        oracle.mu = mu;
        oracle.sigma = sigma;
        oracle.last_updated = now;
        Ok(())
    }

    /// Open a leveraged long or short position, depositing native SOL as collateral.
    ///
    /// position_type: 0 = Long, 1 = Short
    /// collateral: lamports to deposit (SOL/lamports, 9 decimals)
    /// leverage: integer multiplier (e.g., 2 = 2x)
    pub fn open_position(
        ctx: Context<OpenPosition>,
        agent_id: u32,
        position_type: u8,
        collateral: u64,
        leverage: u64,
    ) -> Result<()> {
        let position = &mut ctx.accounts.position;
        let oracle = &mut ctx.accounts.oracle;
        let vault = &ctx.accounts.vault;

        require!(oracle.agent_id == agent_id, PerpsError::InvalidOracle);

        let now = Clock::get()?.unix_timestamp;

        // Funding drift
        let time_delta = now - oracle.last_updated;
        if time_delta > 0 {
            let skew = oracle.total_long_oi as i64 - oracle.total_short_oi as i64;
            oracle.current_funding_rate +=
                (skew * vault.funding_velocity as i64 * time_delta) / vault.skew_scale as i64;
            oracle.last_updated = now;
        }

        require!(leverage >= 1 && leverage <= 100, PerpsError::InvalidLeverage);
        let size = collateral.checked_mul(leverage).ok_or(PerpsError::Overflow)?;

        // Skew-adjusted execution price using vAMM curve (x * y = k)
        let d = vault.skew_scale as i128;
        let skew128 = oracle.total_long_oi as i128 - oracle.total_short_oi as i128;
        let size_signed128: i128 = if position_type == 0 {
            size as i128
        } else {
            -(size as i128)
        };
        let index_price128 = oracle.spot_index as i128;
        
        // Virtual quote reserves before and after trade
        let y1 = d + skew128;
        let y2 = y1 + size_signed128;
        require!(y1 > 0 && y2 > 0, PerpsError::Overflow); // Protect reserve exhaustion

        // Divide midway to prevent i128 overflow: ( (index * y1)/d * y2 ) / d
        let part1 = (index_price128 * y1) / d;
        let exec_price128 = (part1 * y2) / d;
        let exec_price = exec_price128.min(i64::MAX as i128) as i64;

        position.owner = ctx.accounts.trader.key();
        position.agent_id = agent_id;
        position.position_type = position_type;
        position.collateral = collateral;
        position.size = size;
        position.entry_price = exec_price as u64;
        position.last_funding_time = now;

        if position_type == 0 {
            oracle.total_long_oi += size;
        } else {
            oracle.total_short_oi += size;
        }

        // Transfer native SOL collateral from trader → vault PDA
        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.trader.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        system_program::transfer(transfer_ctx, collateral)?;

        Ok(())
    }

    /// Close an existing position, settling PnL back in native SOL.
    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        let position = &ctx.accounts.position;
        let oracle = &mut ctx.accounts.oracle;
        let vault = &ctx.accounts.vault;
        let now = Clock::get()?.unix_timestamp;

        // Funding drift
        let time_delta = now - oracle.last_updated;
        if time_delta > 0 {
            let skew_oi = oracle.total_long_oi as i64 - oracle.total_short_oi as i64;
            oracle.current_funding_rate +=
                (skew_oi * vault.funding_velocity as i64 * time_delta) / vault.skew_scale as i64;
            oracle.last_updated = now;
        }

        // Close-side skew execution price using vAMM curve (x * y = k)
        let d = vault.skew_scale as i128;
        let skew128 = oracle.total_long_oi as i128 - oracle.total_short_oi as i128;
        let size_delta128: i128 = if position.position_type == 0 {
            -(position.size as i128)
        } else {
            position.size as i128
        };
        let index_price128 = oracle.spot_index as i128;
        
        let y1 = d + skew128;
        let y2 = y1 + size_delta128;
        require!(y1 > 0 && y2 > 0, PerpsError::Overflow);

        let part1 = (index_price128 * y1) / d;
        let exec_price128 = (part1 * y2) / d;
        let exec_price = exec_price128.min(i64::MAX as i128) as i64;

        let entry_price = position.entry_price;
        let size = position.size;

        let pnl: i64 = if position.position_type == 0 {
            ((exec_price as i128 - entry_price as i128) * size as i128 / entry_price as i128) as i64
        } else {
            ((entry_price as i128 - exec_price as i128) * size as i128 / entry_price as i128) as i64
        };

        if position.position_type == 0 {
            oracle.total_long_oi -= size;
        } else {
            oracle.total_short_oi -= size;
        }

        let collateral = position.collateral as i64;
        let settlement = std::cmp::max(0, collateral + pnl) as u64;

        // Transfer SOL settlement from vault PDA → owner
        if settlement > 0 {
            // Guard against draining the vault below rent-exempt minimum
            let vault_info = ctx.accounts.vault.to_account_info();
            let vault_lamports = vault_info.lamports();
            let max_payout = vault_lamports.saturating_sub(Rent::get()?.minimum_balance(VaultState::SIZE));
            
            require!(max_payout >= settlement, PerpsError::InsufficientLiquidity);

            **vault_info.try_borrow_mut_lamports()? -= settlement;
            **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? += settlement;
        }

        // Position rent is reclaimed via `close = owner` constraint
        Ok(())
    }

    /// Liquidate an undercollateralized position.
    /// Anyone can call this; seized collateral goes to the insurance fund.
    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        let position = &ctx.accounts.position;
        let oracle = &mut ctx.accounts.oracle;
        let vault = &ctx.accounts.vault;

        let d = vault.skew_scale as i128;
        let skew128 = oracle.total_long_oi as i128 - oracle.total_short_oi as i128;
        let size_delta128: i128 = if position.position_type == 0 {
            -(position.size as i128)
        } else {
            position.size as i128
        };
        let index_price128 = oracle.spot_index as i128;
        
        let y1 = d + skew128;
        let y2 = y1 + size_delta128;
        require!(y1 > 0 && y2 > 0, PerpsError::Overflow);

        let part1 = (index_price128 * y1) / d;
        let exec_price128 = (part1 * y2) / d;
        let exec_price = exec_price128.min(i64::MAX as i128) as i64;

        let entry_price = position.entry_price;
        let size = position.size;

        let pnl: i64 = if position.position_type == 0 {
            ((exec_price as i128 - entry_price as i128) * size as i128 / entry_price as i128) as i64
        } else {
            ((entry_price as i128 - exec_price as i128) * size as i128 / entry_price as i128) as i64
        };

        if position.position_type == 0 {
            oracle.total_long_oi -= size;
        } else {
            oracle.total_short_oi -= size;
        }

        let collateral = position.collateral as i64;
        let equity = collateral + pnl;
        let maintenance_margin = collateral / 10; // 10% maintenance

        require!(equity < maintenance_margin, PerpsError::NotLiquidatable);

        msg!(
            "Liquidated: equity={}, maintenance_margin={}",
            equity,
            maintenance_margin
        );
        Ok(())
    }
}

// ─────────────────────────────────────────────── Account Structs ──

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = authority,
        // VaultState: discriminator(8) + authority(32) + insurance_fund(8) + skew_scale(8) + funding_velocity(8)
        space = 8 + 32 + 8 + 8 + 8,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(agent_id: u32)]
pub struct UpdateOracle<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        // OracleState: discriminator(8) + agent_id(4) + spot_index(8) + mu(8) + sigma(8) + last_updated(8) + total_long_oi(8) + total_short_oi(8) + current_funding_rate(8)
        space = 8 + 4 + 8 + 8 + 8 + 8 + 8 + 8 + 8,
        seeds = [b"oracle", agent_id.to_le_bytes().as_ref()],
        bump
    )]
    pub oracle: Account<'info, OracleState>,
    /// Vault is needed to read skew_scale / funding_velocity during drift update.
    pub vault: Account<'info, VaultState>,
    #[account(mut, address = vault.authority @ PerpsError::InvalidAuthority)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(agent_id: u32)]
pub struct OpenPosition<'info> {
    #[account(
        init,
        payer = trader,
        // PositionState: discriminator(8) + owner(32) + agent_id(4) + position_type(1) + collateral(8) + size(8) + entry_price(8) + last_funding_time(8)
        space = 8 + 32 + 4 + 1 + 8 + 8 + 8 + 8,
        seeds = [b"position", trader.key().as_ref(), agent_id.to_le_bytes().as_ref()],
        bump
    )]
    pub position: Account<'info, PositionState>,
    #[account(mut)]
    pub trader: Signer<'info>,
    /// The vault PDA receives native SOL lamports as collateral.
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub oracle: Account<'info, OracleState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut, has_one = owner, close = owner)]
    pub position: Account<'info, PositionState>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub oracle: Account<'info, OracleState>,
    /// Vault pays out SOL settlement.
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, VaultState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut, close = liquidator)]
    pub position: Account<'info, PositionState>,
    #[account(mut)]
    pub oracle: Account<'info, OracleState>,
    pub vault: Account<'info, VaultState>,
    /// Liquidator receives the rent from the closed position account.
    #[account(mut)]
    pub liquidator: Signer<'info>,
}

// ─────────────────────────────────────────────── State Accounts ──

#[account]
pub struct VaultState {
    pub authority: Pubkey,
    pub insurance_fund: u64,
    pub skew_scale: u64,
    pub funding_velocity: u64,
}

impl VaultState {
    /// Byte size of VaultState account data (used for rent calculation).
    pub const SIZE: usize = 8 + 32 + 8 + 8 + 8; // discriminator + authority + insurance_fund + skew_scale + funding_velocity
}

#[account]
pub struct OracleState {
    pub agent_id: u32,
    pub spot_index: u64,   // Agent price index (9 decimal lamport scale)
    pub mu: u64,           // TrueSkill mean (scaled 1e6)
    pub sigma: u64,        // TrueSkill std dev (scaled 1e6)
    pub last_updated: i64, // Unix timestamp
    pub total_long_oi: u64,
    pub total_short_oi: u64,
    pub current_funding_rate: i64,
}

#[account]
pub struct PositionState {
    pub owner: Pubkey,
    pub agent_id: u32,
    pub position_type: u8, // 0 = Long, 1 = Short
    pub collateral: u64,   // lamports deposited as margin
    pub size: u64,         // collateral * leverage
    pub entry_price: u64,  // skew-adjusted execution price at open
    pub last_funding_time: i64,
}

// ─────────────────────────────────────────────── Error Codes ──

#[error_code]
pub enum PerpsError {
    #[msg("Oracle does not match the requested agent")]
    InvalidOracle,
    #[msg("Position is not undercollateralized; cannot liquidate")]
    NotLiquidatable,
    #[msg("Numeric overflow in size calculation")]
    Overflow,
    #[msg("Unauthorized keeper authority")]
    InvalidAuthority,
    #[msg("Leverage must be between 1 and 100")]
    InvalidLeverage,
    #[msg("Vault possesses insufficient liquidity to settle this position")]
    InsufficientLiquidity,
}
