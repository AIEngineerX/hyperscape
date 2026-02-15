#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use fight_oracle::{MarketSide as OracleSide, MatchResult, MatchStatus};

declare_id!("23YJWaC8AhEufH8eYdPMAouyWEgJ5MQWyvz3z8akTtR6");

pub const MARKET_SEED: &[u8] = b"market";
pub const POSITION_SEED: &[u8] = b"position";
pub const VAULT_AUTH_SEED: &[u8] = b"vault_auth";
pub const YES_VAULT_SEED: &[u8] = b"yes_vault";
pub const NO_VAULT_SEED: &[u8] = b"no_vault";
pub const MARKET_CONFIG_SEED: &[u8] = b"market_config";
pub const MAX_FEE_BPS: u16 = 1_000;

#[program]
pub mod gold_binary_market {
    use super::*;

    pub fn initialize_market_config(
        ctx: Context<InitializeMarketConfig>,
        market_maker: Pubkey,
        fee_wallet: Pubkey,
        fee_bps: u16,
    ) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, ErrorCode::InvalidFeeBps);

        let config = &mut ctx.accounts.market_config;
        if config.authority != Pubkey::default() {
            require_keys_eq!(
                config.authority,
                ctx.accounts.authority.key(),
                ErrorCode::UnauthorizedConfigAuthority
            );
        }

        config.authority = ctx.accounts.authority.key();
        config.market_maker = market_maker;
        config.fee_wallet = fee_wallet;
        config.fee_bps = fee_bps;
        config.bump = ctx.bumps.market_config;

        emit!(MarketConfigUpdated {
            authority: config.authority,
            market_maker: config.market_maker,
            fee_wallet: config.fee_wallet,
            fee_bps: config.fee_bps,
        });

        Ok(())
    }

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        auto_seed_delay_seconds: i64,
    ) -> Result<()> {
        require!(auto_seed_delay_seconds >= 0, ErrorCode::InvalidSeedDelay);
        require_keys_eq!(
            ctx.accounts.market_config.market_maker,
            ctx.accounts.market_maker.key(),
            ErrorCode::ConfigMarketMakerMismatch
        );

        let oracle_match = &ctx.accounts.oracle_match;
        require!(
            oracle_match.status == MatchStatus::Open,
            ErrorCode::OracleNotOpen
        );

        let market = &mut ctx.accounts.market;
        market.oracle_match = oracle_match.key();
        market.match_id = oracle_match.match_id;
        market.gold_mint = ctx.accounts.gold_mint.key();
        market.token_program = ctx.accounts.token_program.key();
        market.market_maker = ctx.accounts.market_maker.key();
        market.open_ts = oracle_match.open_ts;
        market.close_ts = oracle_match.bet_close_ts;
        market.auto_seed_delay_seconds = auto_seed_delay_seconds;
        market.user_yes_total = 0;
        market.user_no_total = 0;
        market.maker_yes_total = 0;
        market.maker_no_total = 0;
        market.status = MarketStatus::Open;
        market.resolved_winner = None;
        market.bump = ctx.bumps.market;
        market.vault_authority_bump = ctx.bumps.vault_authority;
        market.yes_vault_bump = ctx.bumps.yes_vault;
        market.no_vault_bump = ctx.bumps.no_vault;

        emit!(MarketInitialized {
            market: market.key(),
            match_id: market.match_id,
            gold_mint: market.gold_mint,
            open_ts: market.open_ts,
            close_ts: market.close_ts,
        });

        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, side: BetSide, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(
            ctx.accounts.market_config.fee_bps <= MAX_FEE_BPS,
            ErrorCode::InvalidFeeBps
        );
        require_keys_eq!(
            ctx.accounts.market_config.market_maker,
            ctx.accounts.market.market_maker,
            ErrorCode::ConfigMarketMakerMismatch
        );

        let now = Clock::get()?.unix_timestamp;
        let market = &mut ctx.accounts.market;

        require!(
            market.status == MarketStatus::Open,
            ErrorCode::MarketNotOpen
        );
        require!(now >= market.open_ts, ErrorCode::MarketNotOpenYet);
        require!(now < market.close_ts, ErrorCode::BettingClosed);

        let fee_amount = calculate_fee(amount, ctx.accounts.market_config.fee_bps)?;
        let net_amount = amount
            .checked_sub(fee_amount)
            .ok_or(ErrorCode::MathOverflow)?;
        require!(net_amount > 0, ErrorCode::NetAmountTooSmall);

        if fee_amount > 0 {
            transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.bettor_gold_ata.to_account_info(),
                        mint: ctx.accounts.gold_mint.to_account_info(),
                        to: ctx.accounts.fee_wallet_gold_ata.to_account_info(),
                        authority: ctx.accounts.bettor.to_account_info(),
                    },
                ),
                fee_amount,
                ctx.accounts.gold_mint.decimals,
            )?;
        }

        let destination_vault = match side {
            BetSide::Yes => ctx.accounts.yes_vault.to_account_info(),
            BetSide::No => ctx.accounts.no_vault.to_account_info(),
        };

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.bettor_gold_ata.to_account_info(),
                    mint: ctx.accounts.gold_mint.to_account_info(),
                    to: destination_vault,
                    authority: ctx.accounts.bettor.to_account_info(),
                },
            ),
            net_amount,
            ctx.accounts.gold_mint.decimals,
        )?;

        let position = &mut ctx.accounts.position;
        if position.owner == Pubkey::default() {
            position.owner = ctx.accounts.bettor.key();
            position.market = market.key();
            position.yes_stake = 0;
            position.no_stake = 0;
            position.claimed = false;
            position.bump = ctx.bumps.position;
        }

        match side {
            BetSide::Yes => {
                position.yes_stake = position
                    .yes_stake
                    .checked_add(net_amount)
                    .ok_or(ErrorCode::MathOverflow)?;
                if ctx.accounts.bettor.key() == market.market_maker {
                    market.maker_yes_total = market
                        .maker_yes_total
                        .checked_add(net_amount)
                        .ok_or(ErrorCode::MathOverflow)?;
                } else {
                    market.user_yes_total = market
                        .user_yes_total
                        .checked_add(net_amount)
                        .ok_or(ErrorCode::MathOverflow)?;
                }
            }
            BetSide::No => {
                position.no_stake = position
                    .no_stake
                    .checked_add(net_amount)
                    .ok_or(ErrorCode::MathOverflow)?;
                if ctx.accounts.bettor.key() == market.market_maker {
                    market.maker_no_total = market
                        .maker_no_total
                        .checked_add(net_amount)
                        .ok_or(ErrorCode::MathOverflow)?;
                } else {
                    market.user_no_total = market
                        .user_no_total
                        .checked_add(net_amount)
                        .ok_or(ErrorCode::MathOverflow)?;
                }
            }
        }

        emit!(BetPlaced {
            market: market.key(),
            bettor: ctx.accounts.bettor.key(),
            side,
            gross_amount: amount,
            net_amount,
            fee_amount,
        });

        Ok(())
    }

    pub fn seed_liquidity_if_empty(
        ctx: Context<SeedLiquidityIfEmpty>,
        amount_each: u64,
    ) -> Result<()> {
        require!(amount_each > 0, ErrorCode::InvalidAmount);

        let now = Clock::get()?.unix_timestamp;
        let market = &mut ctx.accounts.market;
        require!(
            market.status == MarketStatus::Open,
            ErrorCode::MarketNotOpen
        );
        require_keys_eq!(
            market.market_maker,
            ctx.accounts.market_maker.key(),
            ErrorCode::UnauthorizedMarketMaker
        );
        require!(now >= market.open_ts, ErrorCode::MarketNotOpenYet);
        require!(now < market.close_ts, ErrorCode::BettingClosed);

        let seed_unlock_ts = market
            .open_ts
            .checked_add(market.auto_seed_delay_seconds)
            .ok_or(ErrorCode::MathOverflow)?;
        require!(now >= seed_unlock_ts, ErrorCode::SeedWindowNotReached);
        require!(
            market.user_yes_total == 0,
            ErrorCode::MarketAlreadyHasUserBets
        );
        require!(
            market.user_no_total == 0,
            ErrorCode::MarketAlreadyHasUserBets
        );
        require!(
            market.maker_yes_total == 0,
            ErrorCode::LiquidityAlreadySeeded
        );
        require!(
            market.maker_no_total == 0,
            ErrorCode::LiquidityAlreadySeeded
        );

        let decimals = ctx.accounts.gold_mint.decimals;
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.market_maker_gold_ata.to_account_info(),
                    mint: ctx.accounts.gold_mint.to_account_info(),
                    to: ctx.accounts.yes_vault.to_account_info(),
                    authority: ctx.accounts.market_maker.to_account_info(),
                },
            ),
            amount_each,
            decimals,
        )?;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.market_maker_gold_ata.to_account_info(),
                    mint: ctx.accounts.gold_mint.to_account_info(),
                    to: ctx.accounts.no_vault.to_account_info(),
                    authority: ctx.accounts.market_maker.to_account_info(),
                },
            ),
            amount_each,
            decimals,
        )?;

        let position = &mut ctx.accounts.market_maker_position;
        if position.owner == Pubkey::default() {
            position.owner = ctx.accounts.market_maker.key();
            position.market = market.key();
            position.yes_stake = 0;
            position.no_stake = 0;
            position.claimed = false;
            position.bump = ctx.bumps.market_maker_position;
        }

        position.yes_stake = position
            .yes_stake
            .checked_add(amount_each)
            .ok_or(ErrorCode::MathOverflow)?;
        position.no_stake = position
            .no_stake
            .checked_add(amount_each)
            .ok_or(ErrorCode::MathOverflow)?;

        market.maker_yes_total = market
            .maker_yes_total
            .checked_add(amount_each)
            .ok_or(ErrorCode::MathOverflow)?;
        market.maker_no_total = market
            .maker_no_total
            .checked_add(amount_each)
            .ok_or(ErrorCode::MathOverflow)?;

        emit!(LiquiditySeeded {
            market: market.key(),
            market_maker: ctx.accounts.market_maker.key(),
            amount_each,
        });

        Ok(())
    }

    pub fn resolve_from_oracle(ctx: Context<ResolveFromOracle>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let oracle_match = &ctx.accounts.oracle_match;

        require!(
            market.status == MarketStatus::Open,
            ErrorCode::MarketAlreadyResolved
        );
        require_keys_eq!(
            market.oracle_match,
            oracle_match.key(),
            ErrorCode::OracleMismatch
        );
        require!(
            oracle_match.status == MatchStatus::Resolved,
            ErrorCode::OracleNotResolved
        );

        let winner = oracle_match.winner.ok_or(ErrorCode::OracleMissingWinner)?;
        let winner_side = map_oracle_side(winner);

        let yes_total = market
            .user_yes_total
            .checked_add(market.maker_yes_total)
            .ok_or(ErrorCode::MathOverflow)?;
        let no_total = market
            .user_no_total
            .checked_add(market.maker_no_total)
            .ok_or(ErrorCode::MathOverflow)?;

        let winning_pool = match winner_side {
            BetSide::Yes => yes_total,
            BetSide::No => no_total,
        };

        if winning_pool == 0 {
            market.status = MarketStatus::Void;
            market.resolved_winner = Some(winner_side);
        } else {
            market.status = MarketStatus::Resolved;
            market.resolved_winner = Some(winner_side);
        }

        emit!(MarketResolved {
            market: market.key(),
            winner: winner_side,
            status: market.status,
        });

        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.position;

        require!(
            position.owner == ctx.accounts.bettor.key(),
            ErrorCode::UnauthorizedClaim
        );
        require!(
            position.market == market.key(),
            ErrorCode::PositionMarketMismatch
        );
        require!(!position.claimed, ErrorCode::AlreadyClaimed);

        let yes_total = market
            .user_yes_total
            .checked_add(market.maker_yes_total)
            .ok_or(ErrorCode::MathOverflow)?;
        let no_total = market
            .user_no_total
            .checked_add(market.maker_no_total)
            .ok_or(ErrorCode::MathOverflow)?;

        match market.status {
            MarketStatus::Open => return err!(ErrorCode::MarketNotResolved),
            MarketStatus::Void => {
                transfer_from_vault(
                    position.yes_stake,
                    &ctx.accounts.yes_vault,
                    &ctx.accounts.bettor_gold_ata,
                    &ctx.accounts.gold_mint,
                    &ctx.accounts.token_program,
                    &ctx.accounts.vault_authority,
                    market,
                )?;
                transfer_from_vault(
                    position.no_stake,
                    &ctx.accounts.no_vault,
                    &ctx.accounts.bettor_gold_ata,
                    &ctx.accounts.gold_mint,
                    &ctx.accounts.token_program,
                    &ctx.accounts.vault_authority,
                    market,
                )?;
            }
            MarketStatus::Resolved => {
                let winner = market.resolved_winner.ok_or(ErrorCode::MarketNotResolved)?;

                match winner {
                    BetSide::Yes => {
                        let user_winning = position.yes_stake;
                        require!(user_winning > 0, ErrorCode::NotWinningPosition);

                        let losing_share = proportional_share(user_winning, no_total, yes_total)?;
                        transfer_from_vault(
                            user_winning,
                            &ctx.accounts.yes_vault,
                            &ctx.accounts.bettor_gold_ata,
                            &ctx.accounts.gold_mint,
                            &ctx.accounts.token_program,
                            &ctx.accounts.vault_authority,
                            market,
                        )?;
                        transfer_from_vault(
                            losing_share,
                            &ctx.accounts.no_vault,
                            &ctx.accounts.bettor_gold_ata,
                            &ctx.accounts.gold_mint,
                            &ctx.accounts.token_program,
                            &ctx.accounts.vault_authority,
                            market,
                        )?;
                    }
                    BetSide::No => {
                        let user_winning = position.no_stake;
                        require!(user_winning > 0, ErrorCode::NotWinningPosition);

                        let losing_share = proportional_share(user_winning, yes_total, no_total)?;
                        transfer_from_vault(
                            user_winning,
                            &ctx.accounts.no_vault,
                            &ctx.accounts.bettor_gold_ata,
                            &ctx.accounts.gold_mint,
                            &ctx.accounts.token_program,
                            &ctx.accounts.vault_authority,
                            market,
                        )?;
                        transfer_from_vault(
                            losing_share,
                            &ctx.accounts.yes_vault,
                            &ctx.accounts.bettor_gold_ata,
                            &ctx.accounts.gold_mint,
                            &ctx.accounts.token_program,
                            &ctx.accounts.vault_authority,
                            market,
                        )?;
                    }
                }
            }
        }

        position.claimed = true;

        emit!(Claimed {
            market: market.key(),
            bettor: ctx.accounts.bettor.key(),
            yes_stake: position.yes_stake,
            no_stake: position.no_stake,
        });

        Ok(())
    }
}

fn map_oracle_side(side: OracleSide) -> BetSide {
    match side {
        OracleSide::Yes => BetSide::Yes,
        OracleSide::No => BetSide::No,
    }
}

fn proportional_share(user_stake: u64, losing_pool: u64, winning_pool: u64) -> Result<u64> {
    require!(winning_pool > 0, ErrorCode::NoWinningPool);

    let share = (u128::from(user_stake))
        .checked_mul(u128::from(losing_pool))
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(u128::from(winning_pool))
        .ok_or(ErrorCode::MathOverflow)?;

    u64::try_from(share).map_err(|_| error!(ErrorCode::MathOverflow))
}

fn calculate_fee(amount: u64, fee_bps: u16) -> Result<u64> {
    if fee_bps == 0 {
        return Ok(0);
    }

    let fee = (u128::from(amount))
        .checked_mul(u128::from(fee_bps))
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(10_000)
        .ok_or(ErrorCode::MathOverflow)?;

    u64::try_from(fee).map_err(|_| error!(ErrorCode::MathOverflow))
}

fn transfer_from_vault<'info>(
    amount: u64,
    source: &InterfaceAccount<'info, TokenAccount>,
    destination: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    token_program: &Interface<'info, TokenInterface>,
    vault_authority: &UncheckedAccount<'info>,
    market: &Account<'info, Market>,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let market_key = market.key();
    let signer_seeds: &[&[u8]] = &[
        VAULT_AUTH_SEED,
        market_key.as_ref(),
        &[market.vault_authority_bump],
    ];

    transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: source.to_account_info(),
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: vault_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
        mint.decimals,
    )
}

#[derive(Accounts)]
pub struct InitializeMarketConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + MarketConfig::INIT_SPACE,
        seeds = [MARKET_CONFIG_SEED],
        bump,
    )]
    pub market_config: Account<'info, MarketConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: market maker authority for automatic seed txs.
    pub market_maker: UncheckedAccount<'info>,

    #[account(owner = fight_oracle::ID)]
    pub oracle_match: Account<'info, MatchResult>,

    #[account(
        seeds = [MARKET_CONFIG_SEED],
        bump = market_config.bump,
    )]
    pub market_config: Account<'info, MarketConfig>,

    #[account(
        init,
        payer = payer,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, oracle_match.key().as_ref()],
        bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        seeds = [VAULT_AUTH_SEED, market.key().as_ref()],
        bump,
    )]
    /// CHECK: PDA authority for both vault token accounts.
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        seeds = [YES_VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = gold_mint,
        token::authority = vault_authority,
        token::token_program = token_program,
    )]
    pub yes_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        seeds = [NO_VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = gold_mint,
        token::authority = vault_authority,
        token::token_program = token_program,
    )]
    pub no_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub gold_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.oracle_match.as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        constraint = bettor_gold_ata.owner == bettor.key() @ ErrorCode::InvalidTokenAccountOwner,
        constraint = bettor_gold_ata.mint == gold_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub bettor_gold_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [MARKET_CONFIG_SEED],
        bump = market_config.bump,
    )]
    pub market_config: Account<'info, MarketConfig>,

    #[account(
        mut,
        constraint = fee_wallet_gold_ata.owner == market_config.fee_wallet @ ErrorCode::InvalidFeeWallet,
        constraint = fee_wallet_gold_ata.mint == gold_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub fee_wallet_gold_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [VAULT_AUTH_SEED, market.key().as_ref()],
        bump = market.vault_authority_bump,
    )]
    /// CHECK: PDA authority for both vault token accounts.
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [YES_VAULT_SEED, market.key().as_ref()],
        bump = market.yes_vault_bump,
        constraint = yes_vault.mint == gold_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub yes_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [NO_VAULT_SEED, market.key().as_ref()],
        bump = market.no_vault_bump,
        constraint = no_vault.mint == gold_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub no_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = bettor,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, market.key().as_ref(), bettor.key().as_ref()],
        bump,
    )]
    pub position: Box<Account<'info, Position>>,

    pub gold_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SeedLiquidityIfEmpty<'info> {
    #[account(mut)]
    pub market_maker: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.oracle_match.as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        constraint = market_maker_gold_ata.owner == market_maker.key() @ ErrorCode::InvalidTokenAccountOwner,
        constraint = market_maker_gold_ata.mint == gold_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub market_maker_gold_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [YES_VAULT_SEED, market.key().as_ref()],
        bump = market.yes_vault_bump,
        constraint = yes_vault.mint == gold_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub yes_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [NO_VAULT_SEED, market.key().as_ref()],
        bump = market.no_vault_bump,
        constraint = no_vault.mint == gold_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub no_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = market_maker,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, market.key().as_ref(), market_maker.key().as_ref()],
        bump,
    )]
    pub market_maker_position: Box<Account<'info, Position>>,

    pub gold_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveFromOracle<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.oracle_match.as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(owner = fight_oracle::ID)]
    pub oracle_match: Account<'info, MatchResult>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.oracle_match.as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [POSITION_SEED, market.key().as_ref(), bettor.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        constraint = bettor_gold_ata.owner == bettor.key() @ ErrorCode::InvalidTokenAccountOwner,
        constraint = bettor_gold_ata.mint == gold_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub bettor_gold_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [VAULT_AUTH_SEED, market.key().as_ref()],
        bump = market.vault_authority_bump,
    )]
    /// CHECK: PDA authority for both vault token accounts.
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [YES_VAULT_SEED, market.key().as_ref()],
        bump = market.yes_vault_bump,
    )]
    pub yes_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [NO_VAULT_SEED, market.key().as_ref()],
        bump = market.no_vault_bump,
    )]
    pub no_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub gold_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub oracle_match: Pubkey,
    pub match_id: u64,
    pub gold_mint: Pubkey,
    pub token_program: Pubkey,
    pub market_maker: Pubkey,
    pub open_ts: i64,
    pub close_ts: i64,
    pub auto_seed_delay_seconds: i64,
    pub user_yes_total: u64,
    pub user_no_total: u64,
    pub maker_yes_total: u64,
    pub maker_no_total: u64,
    pub resolved_winner: Option<BetSide>,
    pub status: MarketStatus,
    pub bump: u8,
    pub vault_authority_bump: u8,
    pub yes_vault_bump: u8,
    pub no_vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub yes_stake: u64,
    pub no_stake: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MarketConfig {
    pub authority: Pubkey,
    pub market_maker: Pubkey,
    pub fee_wallet: Pubkey,
    pub fee_bps: u16,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq, InitSpace)]
pub enum BetSide {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq, InitSpace)]
pub enum MarketStatus {
    Open,
    Resolved,
    Void,
}

#[event]
pub struct MarketInitialized {
    pub market: Pubkey,
    pub match_id: u64,
    pub gold_mint: Pubkey,
    pub open_ts: i64,
    pub close_ts: i64,
}

#[event]
pub struct BetPlaced {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub side: BetSide,
    pub gross_amount: u64,
    pub net_amount: u64,
    pub fee_amount: u64,
}

#[event]
pub struct MarketConfigUpdated {
    pub authority: Pubkey,
    pub market_maker: Pubkey,
    pub fee_wallet: Pubkey,
    pub fee_bps: u16,
}

#[event]
pub struct LiquiditySeeded {
    pub market: Pubkey,
    pub market_maker: Pubkey,
    pub amount_each: u64,
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub winner: BetSide,
    pub status: MarketStatus,
}

#[event]
pub struct Claimed {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub yes_stake: u64,
    pub no_stake: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid seed delay")]
    InvalidSeedDelay,
    #[msg("Market not open")]
    MarketNotOpen,
    #[msg("Market not open yet")]
    MarketNotOpenYet,
    #[msg("Betting is closed")]
    BettingClosed,
    #[msg("Oracle match must be open when market is initialized")]
    OracleNotOpen,
    #[msg("Only the configured market maker can seed liquidity")]
    UnauthorizedMarketMaker,
    #[msg("Seed liquidity window not reached yet")]
    SeedWindowNotReached,
    #[msg("Market already has user bets")]
    MarketAlreadyHasUserBets,
    #[msg("Liquidity was already seeded")]
    LiquidityAlreadySeeded,
    #[msg("Market already resolved")]
    MarketAlreadyResolved,
    #[msg("Oracle account does not match the market")]
    OracleMismatch,
    #[msg("Oracle result not posted yet")]
    OracleNotResolved,
    #[msg("Oracle result is missing winner value")]
    OracleMissingWinner,
    #[msg("Market not resolved")]
    MarketNotResolved,
    #[msg("Position has already been claimed")]
    AlreadyClaimed,
    #[msg("Position is not on the winning side")]
    NotWinningPosition,
    #[msg("Claim signer does not match position owner")]
    UnauthorizedClaim,
    #[msg("Position does not belong to this market")]
    PositionMarketMismatch,
    #[msg("No winning pool exists")]
    NoWinningPool,
    #[msg("Token account owner mismatch")]
    InvalidTokenAccountOwner,
    #[msg("Token mint mismatch")]
    InvalidMint,
    #[msg("Fee basis points are invalid")]
    InvalidFeeBps,
    #[msg("Only config authority can update market config")]
    UnauthorizedConfigAuthority,
    #[msg("Market maker does not match program config")]
    ConfigMarketMakerMismatch,
    #[msg("Fee wallet token account is invalid")]
    InvalidFeeWallet,
    #[msg("Amount too small after fee")]
    NetAmountTooSmall,
}
