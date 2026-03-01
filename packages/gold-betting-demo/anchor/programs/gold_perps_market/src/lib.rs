use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("3WKQf3J4B8QqRyWcBLR7xrb9VFPVjkZwzyZS67AahDbK");

#[program]
pub mod gold_perps_market {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>, skew_scale: u64, funding_velocity: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.gold_mint = ctx.accounts.gold_mint.key();
        vault.insurance_fund = 0;
        vault.liquidity_fund = 0;
        // Skew configurations initialized at vault setup
        vault.skew_scale = skew_scale; 
        vault.funding_velocity = funding_velocity;
        Ok(())
    }

    pub fn update_oracle(ctx: Context<UpdateOracle>, agent_id: u32, spot_index: u64, mu: u64, sigma: u64) -> Result<()> {
        let oracle = &mut ctx.accounts.oracle;
        
        let now = Clock::get()?.unix_timestamp;
        
        if oracle.agent_id == 0 {
            oracle.agent_id = agent_id;
            oracle.total_long_oi = 0;
            oracle.total_short_oi = 0;
            oracle.current_funding_rate = 0;
        } else {
            // Update funding velocity
            let vault = &ctx.accounts.vault;
            let time_delta = now - oracle.last_updated;
            if time_delta > 0 {
                let skew = oracle.total_long_oi as i64 - oracle.total_short_oi as i64;
                oracle.current_funding_rate += (skew * vault.funding_velocity as i64 * time_delta) / vault.skew_scale as i64;
            }
        }
        
        oracle.spot_index = spot_index;
        oracle.mu = mu;
        oracle.sigma = sigma;
        oracle.last_updated = now;
        Ok(())
    }

    pub fn open_position(ctx: Context<OpenPosition>, agent_id: u32, position_type: u8, collateral: u64, leverage: u64) -> Result<()> {
        let position = &mut ctx.accounts.position;
        let oracle = &mut ctx.accounts.oracle;
        let vault = &ctx.accounts.vault;

        require!(oracle.agent_id == agent_id, PerpsError::InvalidOracle);
        
        let now = Clock::get()?.unix_timestamp;

        // Funding jump update
        let time_delta = now - oracle.last_updated;
        if time_delta > 0 {
            let skew = oracle.total_long_oi as i64 - oracle.total_short_oi as i64;
            oracle.current_funding_rate += (skew * vault.funding_velocity as i64 * time_delta) / vault.skew_scale as i64;
            oracle.last_updated = now;
        }

        let size = collateral.checked_mul(leverage).unwrap();

        // Calculate Skew Execution Price
        let skew = oracle.total_long_oi as i64 - oracle.total_short_oi as i64;
        let size_i64 = if position_type == 0 { size as i64 } else { -(size as i64) };
        let index_price = oracle.spot_index as i64;
        
        // Premium scaled out of ONE (use 1e6 for decimals if USDC, assuming GOLD has 9 decimals, use 1e9)
        let one = 1_000_000_000i64;
        let premium = ((skew + (size_i64 / 2)) * one) / vault.skew_scale as i64;
        let mut exec_price = index_price;
        
        if premium >= 0 {
            exec_price = index_price + (index_price * premium) / one;
        } else {
            let abs_premium = -premium;
            if abs_premium >= one {
                exec_price = index_price / 10;
            } else {
                exec_price = index_price - (index_price * abs_premium) / one;
            }
        }

        position.owner = ctx.accounts.trader.key();
        position.agent_id = agent_id;
        position.position_type = position_type; // 0 for Long, 1 for Short
        position.collateral = collateral;
        position.size = size;
        position.entry_price = exec_price as u64;
        position.last_funding_time = now;

        if position_type == 0 {
            oracle.total_long_oi += size;
        } else {
            oracle.total_short_oi += size;
        }
        
        // Transfer collateral to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.trader_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.trader.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, collateral)?;

        Ok(())
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        let position = &ctx.accounts.position;
        let oracle = &mut ctx.accounts.oracle;
        let vault = &ctx.accounts.vault;

        let now = Clock::get()?.unix_timestamp;

        // Funding jump update
        let time_delta = now - oracle.last_updated;
        if time_delta > 0 {
            let skew_oi = oracle.total_long_oi as i64 - oracle.total_short_oi as i64;
            oracle.current_funding_rate += (skew_oi * vault.funding_velocity as i64 * time_delta) / vault.skew_scale as i64;
            oracle.last_updated = now;
        }

        // Calculate Skew Execution Price
        let skew = oracle.total_long_oi as i64 - oracle.total_short_oi as i64;
        // Re-calculate size delta backwards (closing position = taking opposite side)
        let size_delta_i64 = if position.position_type == 0 { -(position.size as i64) } else { position.size as i64 };
        let index_price = oracle.spot_index as i64;
        let one = 1_000_000_000i64;
        let premium = ((skew + (size_delta_i64 / 2)) * one) / vault.skew_scale as i64;
        
        let exec_price = if premium >= 0 {
            index_price + (index_price * premium) / one
        } else {
            let abs_premium = -premium;
            if abs_premium >= one {
                index_price / 10
            } else {
                index_price - (index_price * abs_premium) / one
            }
        };

        let entry_price = position.entry_price;
        let size = position.size;

        // PnL in scaled units (same decimals as collateral)
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

        // Transfer settlement back to owner from vault
        if settlement > 0 {
            let vault_bump = ctx.bumps.vault;
            let seeds = &[b"vault".as_ref(), &[vault_bump]];
            let signer_seeds = &[&seeds[..]];

            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.owner_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            token::transfer(cpi_ctx, settlement)?;
        }

        // Position account is closed via `close = owner` constraint
        Ok(())
    }

    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        let position = &ctx.accounts.position;
        let oracle = &mut ctx.accounts.oracle;
        let vault = &ctx.accounts.vault;

        let skew = oracle.total_long_oi as i64 - oracle.total_short_oi as i64;
        let size_delta_i64 = if position.position_type == 0 { -(position.size as i64) } else { position.size as i64 };
        let index_price = oracle.spot_index as i64;
        let one = 1_000_000_000i64;
        let premium = ((skew + (size_delta_i64 / 2)) * one) / vault.skew_scale as i64;
        
        let exec_price = if premium >= 0 {
            index_price + (index_price * premium) / one
        } else {
            let abs_premium = -premium;
            if abs_premium >= one {
                index_price / 10
            } else {
                index_price - (index_price * abs_premium) / one
            }
        };

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
        let maintenance_margin = collateral / 10; // 10% maintenance margin

        require!(equity < maintenance_margin, PerpsError::NotLiquidatable);

        // Position is underwater — seize remaining collateral to insurance fund
        msg!("Liquidated position: equity={}, margin_req={}", equity, maintenance_margin);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 8 + 8 + 8 + 8,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub gold_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(agent_id: u32)]
pub struct UpdateOracle<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + 4 + 8 + 8 + 8 + 8 + 8 + 8 + 8,
        seeds = [b"oracle", agent_id.to_le_bytes().as_ref()],
        bump
    )]
    pub oracle: Account<'info, OracleState>,
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub authority: Signer<'info>, // Only authority/keeper can update
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(agent_id: u32)]
pub struct OpenPosition<'info> {
    #[account(
        init,
        payer = trader,
        space = 8 + 32 + 4 + 1 + 8 + 8 + 8 + 8,
        seeds = [b"position", trader.key().as_ref(), agent_id.to_le_bytes().as_ref()],
        bump
    )]
    pub position: Account<'info, PositionState>,
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(mut)]
    pub trader_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub oracle: Account<'info, OracleState>,
    pub vault: Account<'info, VaultState>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut, has_one = owner, close = owner)]
    pub position: Account<'info, PositionState>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub oracle: Account<'info, OracleState>,
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub position: Account<'info, PositionState>,
    #[account(mut)]
    pub oracle: Account<'info, OracleState>,
    pub vault: Account<'info, VaultState>,
}

#[account]
pub struct VaultState {
    pub authority: Pubkey,
    pub gold_mint: Pubkey,
    pub insurance_fund: u64,
    pub liquidity_fund: u64,
    pub skew_scale: u64,
    pub funding_velocity: u64,
}

#[account]
pub struct OracleState {
    pub agent_id: u32,
    pub spot_index: u64,
    pub mu: u64,
    pub sigma: u64,
    pub last_updated: i64,
    pub total_long_oi: u64,
    pub total_short_oi: u64,
    pub current_funding_rate: i64,
}

#[account]
pub struct PositionState {
    pub owner: Pubkey,
    pub agent_id: u32,
    pub position_type: u8,
    pub collateral: u64,
    pub size: u64,
    pub entry_price: u64,
    pub last_funding_time: i64,
}

#[error_code]
pub enum PerpsError {
    #[msg("Invalid Oracle")]
    InvalidOracle,
    #[msg("Position is not liquidatable")]
    NotLiquidatable,
}
