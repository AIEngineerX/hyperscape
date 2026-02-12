#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("9NdidShnVzy1fc1WHWJTvyuXmH47ynfNGA6QFdyfAuSU");

const SIDE_A: u8 = 1;
const SIDE_B: u8 = 2;
const STATUS_BETTING: u8 = 1;
const STATUS_LOCKED: u8 = 2;
const STATUS_RESOLVED: u8 = 3;
const MAX_METADATA_URI_LEN: usize = 200;
const MAX_BPS: u16 = 10_000;

#[program]
pub mod hyperscape_prediction_market {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        fee_bps: u16,
        reporter: Pubkey,
        keeper: Pubkey,
    ) -> Result<()> {
        require!(fee_bps <= MAX_BPS, MarketError::InvalidFeeBps);

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.reporter = reporter;
        config.keeper = keeper;
        config.fee_bps = fee_bps;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_reporter: Option<Pubkey>,
        new_keeper: Option<Pubkey>,
        new_fee_bps: Option<u16>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require_keys_eq!(
            config.authority,
            ctx.accounts.authority.key(),
            MarketError::Unauthorized
        );

        if let Some(reporter) = new_reporter {
            config.reporter = reporter;
        }
        if let Some(keeper) = new_keeper {
            config.keeper = keeper;
        }
        if let Some(fee_bps) = new_fee_bps {
            require!(fee_bps <= MAX_BPS, MarketError::InvalidFeeBps);
            config.fee_bps = fee_bps;
        }
        Ok(())
    }

    pub fn init_oracle_round(
        ctx: Context<InitOracleRound>,
        round_id: [u8; 32],
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require_keys_eq!(
            config.authority,
            ctx.accounts.authority.key(),
            MarketError::Unauthorized
        );

        let oracle_round = &mut ctx.accounts.oracle_round;
        oracle_round.round_id = round_id;
        oracle_round.finalized = false;
        oracle_round.winner_side = 0;
        oracle_round.reported_at_slot = 0;
        oracle_round.reported_at_ts = 0;
        oracle_round.result_hash = [0u8; 32];
        oracle_round.metadata_uri = String::new();
        oracle_round.bump = ctx.bumps.oracle_round;
        Ok(())
    }

    pub fn report_outcome(
        ctx: Context<ReportOutcome>,
        round_id: [u8; 32],
        winner_side: u8,
        result_hash: [u8; 32],
        metadata_uri: String,
    ) -> Result<()> {
        require!(
            winner_side == SIDE_A || winner_side == SIDE_B,
            MarketError::InvalidSide
        );
        require!(
            metadata_uri.len() <= MAX_METADATA_URI_LEN,
            MarketError::MetadataUriTooLong
        );

        let config = &ctx.accounts.config;
        require_keys_eq!(
            config.reporter,
            ctx.accounts.reporter.key(),
            MarketError::Unauthorized
        );

        let oracle_round = &mut ctx.accounts.oracle_round;
        require!(
            oracle_round.round_id == round_id,
            MarketError::RoundIdMismatch
        );
        require!(!oracle_round.finalized, MarketError::OracleAlreadyFinalized);

        oracle_round.finalized = true;
        oracle_round.winner_side = winner_side;
        oracle_round.result_hash = result_hash;
        oracle_round.metadata_uri = metadata_uri;
        oracle_round.reported_at_slot = Clock::get()?.slot;
        oracle_round.reported_at_ts = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn init_market(
        ctx: Context<InitMarket>,
        round_id: [u8; 32],
        close_slot: u64,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require_keys_eq!(
            config.authority,
            ctx.accounts.authority.key(),
            MarketError::Unauthorized
        );

        let oracle_round = &ctx.accounts.oracle_round;
        require!(
            oracle_round.round_id == round_id,
            MarketError::RoundIdMismatch
        );
        require!(!oracle_round.finalized, MarketError::OracleAlreadyFinalized);
        require!(
            close_slot > Clock::get()?.slot,
            MarketError::InvalidCloseSlot
        );

        let market = &mut ctx.accounts.market;
        market.round_id = round_id;
        market.oracle_round = oracle_round.key();
        market.mint = ctx.accounts.mint.key();
        market.vault = ctx.accounts.market_vault.key();
        market.fee_vault = ctx.accounts.fee_vault.key();
        market.close_slot = close_slot;
        market.resolved_slot = 0;
        market.status = STATUS_BETTING;
        market.winner_side = 0;
        market.pool_a = 0;
        market.pool_b = 0;
        market.winner_pool = 0;
        market.loser_pool = 0;
        market.distributable_loser_pool = 0;
        market.fee_amount = 0;
        market.fee_bps = config.fee_bps;
        market.bump = ctx.bumps.market;
        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, side: u8, amount_gold: u64) -> Result<()> {
        require!(
            side == SIDE_A || side == SIDE_B,
            MarketError::InvalidSide
        );
        require!(amount_gold > 0, MarketError::InvalidAmount);

        let market = &mut ctx.accounts.market;
        require_eq!(market.status, STATUS_BETTING, MarketError::MarketNotOpen);
        require!(
            Clock::get()?.slot < market.close_slot,
            MarketError::BettingClosed
        );

        let decimals = ctx.accounts.mint.decimals;
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.bettor_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.market_vault.to_account_info(),
                authority: ctx.accounts.bettor.to_account_info(),
            },
        );
        transfer_checked(transfer_ctx, amount_gold, decimals)?;

        process_bet_position_update(
            market,
            &mut ctx.accounts.position,
            ctx.accounts.bettor.key(),
            side,
            amount_gold,
            ctx.bumps.position,
        )
    }

    pub fn place_bet_for(
        ctx: Context<PlaceBetFor>,
        side: u8,
        amount_gold: u64,
    ) -> Result<()> {
        require!(
            side == SIDE_A || side == SIDE_B,
            MarketError::InvalidSide
        );
        require!(amount_gold > 0, MarketError::InvalidAmount);
        require!(
            ctx.accounts.payer.key() == ctx.accounts.config.authority
                || ctx.accounts.payer.key() == ctx.accounts.config.keeper,
            MarketError::Unauthorized
        );

        let market = &mut ctx.accounts.market;
        require_eq!(market.status, STATUS_BETTING, MarketError::MarketNotOpen);
        require!(
            Clock::get()?.slot < market.close_slot,
            MarketError::BettingClosed
        );

        let decimals = ctx.accounts.mint.decimals;
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.source_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.market_vault.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            },
        );
        transfer_checked(transfer_ctx, amount_gold, decimals)?;

        process_bet_position_update(
            market,
            &mut ctx.accounts.position,
            ctx.accounts.bettor.key(),
            side,
            amount_gold,
            ctx.bumps.position,
        )
    }

    pub fn lock_market(ctx: Context<LockMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(
            market.status == STATUS_BETTING,
            MarketError::InvalidMarketState
        );
        require!(
            Clock::get()?.slot >= market.close_slot,
            MarketError::CloseSlotNotReached
        );
        market.status = STATUS_LOCKED;
        Ok(())
    }

    pub fn resolve_market_from_oracle(ctx: Context<ResolveMarket>) -> Result<()> {
        let config = &ctx.accounts.config;
        let resolver = ctx.accounts.resolver.key();
        require!(
            resolver == config.authority || resolver == config.keeper,
            MarketError::Unauthorized
        );

        let market = &mut ctx.accounts.market;
        require!(
            market.status == STATUS_LOCKED || market.status == STATUS_BETTING,
            MarketError::InvalidMarketState
        );
        require!(
            Clock::get()?.slot >= market.close_slot,
            MarketError::CloseSlotNotReached
        );

        let oracle_round = &ctx.accounts.oracle_round;
        require_eq!(
            market.oracle_round,
            oracle_round.key(),
            MarketError::OracleRoundMismatch
        );
        require!(oracle_round.finalized, MarketError::OracleNotFinalized);

        let winner_side = oracle_round.winner_side;
        require!(
            winner_side == SIDE_A || winner_side == SIDE_B,
            MarketError::InvalidSide
        );

        let winner_pool = if winner_side == SIDE_A {
            market.pool_a
        } else {
            market.pool_b
        };
        let loser_pool = if winner_side == SIDE_A {
            market.pool_b
        } else {
            market.pool_a
        };

        let fee_amount = ((loser_pool as u128)
            .checked_mul(market.fee_bps as u128)
            .ok_or(MarketError::MathOverflow)?
            / (MAX_BPS as u128)) as u64;
        let distributable_loser_pool = loser_pool
            .checked_sub(fee_amount)
            .ok_or(MarketError::MathOverflow)?;

        market.winner_side = winner_side;
        market.winner_pool = winner_pool;
        market.loser_pool = loser_pool;
        market.distributable_loser_pool = distributable_loser_pool;
        market.fee_amount = fee_amount;
        market.status = STATUS_RESOLVED;
        market.resolved_slot = Clock::get()?.slot;

        if fee_amount > 0 {
            let decimals = ctx.accounts.mint.decimals;
            let seeds: &[&[u8]] = &[b"market", &market.round_id, &[market.bump]];
            let signer_seeds: &[&[&[u8]]] = &[seeds];
            let fee_transfer_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.market_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.fee_vault.to_account_info(),
                    authority: market.to_account_info(),
                },
                signer_seeds,
            );
            transfer_checked(fee_transfer_ctx, fee_amount, decimals)?;
        }

        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        process_claim(
            &ctx.accounts.market,
            &ctx.accounts.mint,
            &mut ctx.accounts.position,
            &ctx.accounts.market_vault,
            &ctx.accounts.destination_ata,
            &ctx.accounts.token_program,
        )
    }

    pub fn claim_for(ctx: Context<ClaimFor>) -> Result<()> {
        let config = &ctx.accounts.config;
        let payer = ctx.accounts.payer.key();
        require!(
            payer == config.authority || payer == config.keeper,
            MarketError::Unauthorized
        );

        process_claim(
            &ctx.accounts.market,
            &ctx.accounts.mint,
            &mut ctx.accounts.position,
            &ctx.accounts.market_vault,
            &ctx.accounts.destination_ata,
            &ctx.accounts.token_program,
        )
    }
}

fn process_claim<'info>(
    market: &Account<'info, MarketRound>,
    mint: &InterfaceAccount<'info, Mint>,
    position: &mut Account<'info, Position>,
    market_vault: &InterfaceAccount<'info, TokenAccount>,
    destination_ata: &InterfaceAccount<'info, TokenAccount>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<()> {
    require_eq!(market.status, STATUS_RESOLVED, MarketError::MarketNotResolved);
    require_eq!(position.market, market.key(), MarketError::InvalidPosition);
    require!(!position.claimed, MarketError::PositionAlreadyClaimed);
    require!(position.stake_gold > 0, MarketError::NoStake);

    let payout = if position.side == market.winner_side {
        if market.winner_pool == 0 {
            0
        } else {
            let bonus = (position.stake_gold as u128)
                .checked_mul(market.distributable_loser_pool as u128)
                .ok_or(MarketError::MathOverflow)?
                .checked_div(market.winner_pool as u128)
                .ok_or(MarketError::MathOverflow)? as u64;
            position
                .stake_gold
                .checked_add(bonus)
                .ok_or(MarketError::MathOverflow)?
        }
    } else {
        0
    };

    position.claimed = true;

    if payout == 0 {
        return Ok(());
    }

    let seeds: &[&[u8]] = &[b"market", &market.round_id, &[market.bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];
    let decimals = mint.decimals;
    let transfer_ctx = CpiContext::new_with_signer(
        token_program.to_account_info(),
        TransferChecked {
            from: market_vault.to_account_info(),
            mint: mint.to_account_info(),
            to: destination_ata.to_account_info(),
            authority: market.to_account_info(),
        },
        signer_seeds,
    );
    transfer_checked(transfer_ctx, payout, decimals)?;
    Ok(())
}

fn process_bet_position_update<'info>(
    market: &mut Account<'info, MarketRound>,
    position: &mut Account<'info, Position>,
    bettor: Pubkey,
    side: u8,
    amount_gold: u64,
    position_bump: u8,
) -> Result<()> {
    if position.market == Pubkey::default() {
        position.market = market.key();
        position.bettor = bettor;
        position.side = side;
        position.stake_gold = 0;
        position.claimed = false;
        position.bump = position_bump;
    } else {
        require_eq!(position.market, market.key(), MarketError::InvalidPosition);
        require_eq!(position.bettor, bettor, MarketError::InvalidPosition);
        require!(!position.claimed, MarketError::PositionAlreadyClaimed);
        require_eq!(position.side, side, MarketError::SingleSidePerPosition);
    }

    position.stake_gold = position
        .stake_gold
        .checked_add(amount_gold)
        .ok_or(MarketError::MathOverflow)?;

    if side == SIDE_A {
        market.pool_a = market
            .pool_a
            .checked_add(amount_gold)
            .ok_or(MarketError::MathOverflow)?;
    } else {
        market.pool_b = market
            .pool_b
            .checked_add(amount_gold)
            .ok_or(MarketError::MathOverflow)?;
    }

    Ok(())
}

#[account]
pub struct GlobalConfig {
    pub authority: Pubkey,
    pub reporter: Pubkey,
    pub keeper: Pubkey,
    pub fee_bps: u16,
    pub bump: u8,
}

impl GlobalConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 2 + 1;
}

#[account]
pub struct OracleRound {
    pub round_id: [u8; 32],
    pub finalized: bool,
    pub winner_side: u8,
    pub reported_at_slot: u64,
    pub reported_at_ts: i64,
    pub result_hash: [u8; 32],
    pub metadata_uri: String,
    pub bump: u8,
}

impl OracleRound {
    pub const SPACE: usize = 8 + 32 + 1 + 1 + 8 + 8 + 32 + 4 + MAX_METADATA_URI_LEN + 1;
}

#[account]
pub struct MarketRound {
    pub round_id: [u8; 32],
    pub oracle_round: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub fee_vault: Pubkey,
    pub close_slot: u64,
    pub resolved_slot: u64,
    pub status: u8,
    pub winner_side: u8,
    pub pool_a: u64,
    pub pool_b: u64,
    pub winner_pool: u64,
    pub loser_pool: u64,
    pub distributable_loser_pool: u64,
    pub fee_amount: u64,
    pub fee_bps: u16,
    pub bump: u8,
}

impl MarketRound {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 2 + 1;
}

#[account]
pub struct Position {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub side: u8,
    pub stake_gold: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl Position {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 8 + 1 + 1;
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = GlobalConfig::SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, GlobalConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,
}

#[derive(Accounts)]
#[instruction(round_id: [u8; 32])]
pub struct InitOracleRound<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        init,
        payer = authority,
        space = OracleRound::SPACE,
        seeds = [b"oracle", round_id.as_ref()],
        bump
    )]
    pub oracle_round: Account<'info, OracleRound>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: [u8; 32])]
pub struct ReportOutcome<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [b"oracle", round_id.as_ref()],
        bump = oracle_round.bump
    )]
    pub oracle_round: Account<'info, OracleRound>,
}

#[derive(Accounts)]
#[instruction(round_id: [u8; 32])]
pub struct InitMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        seeds = [b"oracle", round_id.as_ref()],
        bump = oracle_round.bump
    )]
    pub oracle_round: Account<'info, OracleRound>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = MarketRound::SPACE,
        seeds = [b"market", round_id.as_ref()],
        bump
    )]
    pub market: Account<'info, MarketRound>,
    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = market,
        associated_token::token_program = token_program
    )]
    pub market_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = config,
        associated_token::token_program = token_program
    )]
    pub fee_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        constraint = market.mint == mint.key() @ MarketError::InvalidMint
    )]
    pub market: Account<'info, MarketRound>,
    #[account(
        mut,
        constraint = market_vault.key() == market.vault @ MarketError::InvalidVault,
        constraint = market_vault.mint == mint.key() @ MarketError::InvalidMint
    )]
    pub market_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = bettor_token_account.owner == bettor.key() @ MarketError::InvalidBettorTokenAccount,
        constraint = bettor_token_account.mint == mint.key() @ MarketError::InvalidMint
    )]
    pub bettor_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = bettor,
        space = Position::SPACE,
        seeds = [b"position", market.key().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBetFor<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        constraint = market.mint == mint.key() @ MarketError::InvalidMint
    )]
    pub market: Account<'info, MarketRound>,
    #[account(
        mut,
        constraint = market_vault.key() == market.vault @ MarketError::InvalidVault,
        constraint = market_vault.mint == mint.key() @ MarketError::InvalidMint
    )]
    pub market_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = source_token_account.owner == payer.key() @ MarketError::InvalidSourceTokenAccount,
        constraint = source_token_account.mint == mint.key() @ MarketError::InvalidMint
    )]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: bettor public key is only used as a deterministic PDA seed.
    pub bettor: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = Position::SPACE,
        seeds = [b"position", market.key().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LockMarket<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub market: Account<'info, MarketRound>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub market: Account<'info, MarketRound>,
    #[account(
        constraint = oracle_round.key() == market.oracle_round @ MarketError::OracleRoundMismatch
    )]
    pub oracle_round: Account<'info, OracleRound>,
    #[account(
        mut,
        constraint = market_vault.key() == market.vault @ MarketError::InvalidVault,
        constraint = market_vault.mint == mint.key() @ MarketError::InvalidMint
    )]
    pub market_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        constraint = fee_vault.key() == market.fee_vault @ MarketError::InvalidFeeVault,
        constraint = fee_vault.mint == mint.key() @ MarketError::InvalidMint
    )]
    pub fee_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        constraint = market.mint == mint.key() @ MarketError::InvalidMint
    )]
    pub market: Account<'info, MarketRound>,
    #[account(
        mut,
        constraint = market_vault.key() == market.vault @ MarketError::InvalidVault,
        constraint = market_vault.mint == mint.key() @ MarketError::InvalidMint
    )]
    pub market_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), bettor.key().as_ref()],
        bump = position.bump,
        constraint = position.bettor == bettor.key() @ MarketError::InvalidPosition
    )]
    pub position: Account<'info, Position>,
    #[account(
        mut,
        constraint = destination_ata.owner == bettor.key() @ MarketError::InvalidDestinationAta,
        constraint = destination_ata.mint == mint.key() @ MarketError::InvalidMint
    )]
    pub destination_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ClaimFor<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        constraint = market.mint == mint.key() @ MarketError::InvalidMint
    )]
    pub market: Account<'info, MarketRound>,
    #[account(
        mut,
        constraint = market_vault.key() == market.vault @ MarketError::InvalidVault,
        constraint = market_vault.mint == mint.key() @ MarketError::InvalidMint
    )]
    pub market_vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: bettor public key is only used as a deterministic PDA seed.
    pub bettor: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), bettor.key().as_ref()],
        bump = position.bump,
        constraint = position.bettor == bettor.key() @ MarketError::InvalidPosition
    )]
    pub position: Account<'info, Position>,
    #[account(
        mut,
        constraint = destination_ata.owner == bettor.key() @ MarketError::InvalidDestinationAta,
        constraint = destination_ata.mint == mint.key() @ MarketError::InvalidMint
    )]
    pub destination_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[error_code]
pub enum MarketError {
    #[msg("Unauthorized action")]
    Unauthorized,
    #[msg("Invalid fee bps")]
    InvalidFeeBps,
    #[msg("Invalid side")]
    InvalidSide,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Round ID mismatch")]
    RoundIdMismatch,
    #[msg("Invalid close slot")]
    InvalidCloseSlot,
    #[msg("Market is not open for betting")]
    MarketNotOpen,
    #[msg("Betting is closed")]
    BettingClosed,
    #[msg("Invalid market state")]
    InvalidMarketState,
    #[msg("Close slot has not been reached")]
    CloseSlotNotReached,
    #[msg("Oracle round mismatch")]
    OracleRoundMismatch,
    #[msg("Oracle result is not finalized")]
    OracleNotFinalized,
    #[msg("Oracle round is already finalized")]
    OracleAlreadyFinalized,
    #[msg("Metadata URI exceeds max length")]
    MetadataUriTooLong,
    #[msg("Invalid mint account")]
    InvalidMint,
    #[msg("Invalid vault account")]
    InvalidVault,
    #[msg("Invalid fee vault account")]
    InvalidFeeVault,
    #[msg("Invalid bettor token account")]
    InvalidBettorTokenAccount,
    #[msg("Invalid source token account")]
    InvalidSourceTokenAccount,
    #[msg("Invalid destination token account")]
    InvalidDestinationAta,
    #[msg("Invalid position account")]
    InvalidPosition,
    #[msg("Position already claimed")]
    PositionAlreadyClaimed,
    #[msg("No stake found")]
    NoStake,
    #[msg("Market is not resolved")]
    MarketNotResolved,
    #[msg("Position can only bet one side")]
    SingleSidePerPosition,
}
