/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/gold_perps_market.json`.
 */
export type GoldPerpsMarket = {
  address: "3WKQf3J4B8QqRyWcBLR7xrb9VFPVjkZwzyZS67AahDbK";
  metadata: {
    name: "goldPerpsMarket";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Created with Anchor";
  };
  docs: [
    "Native-SOL Perpetuals Market.",
    "",
    "Collateral is deposited as lamports into the VaultState PDA itself",
    "(no SPL token accounts needed). This mirrors how ETH/BNB are used",
    "on the EVM chains: the native coin is the margin currency.",
    "",
    "Decimal convention: all lamport amounts use 9 decimals (1 SOL = 1_000_000_000 lamports).",
    "Prices are also stored with 9 implied decimals (same as Solana's native precision).",
  ];
  instructions: [
    {
      name: "closePosition";
      docs: ["Close an existing position, settling PnL back in native SOL."];
      discriminator: [123, 134, 81, 0, 49, 68, 98, 98];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "owner";
          writable: true;
          signer: true;
          relations: ["position"];
        },
        {
          name: "oracle";
          writable: true;
        },
        {
          name: "vault";
          docs: ["Vault pays out SOL settlement."];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "initializeVault";
      docs: [
        "Initialize the global vault.",
        "skew_scale and funding_velocity control the market's price impact curve.",
      ];
      discriminator: [48, 191, 163, 44, 71, 129, 63, 164];
      accounts: [
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
            ];
          };
        },
        {
          name: "authority";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "skewScale";
          type: "u64";
        },
        {
          name: "fundingVelocity";
          type: "u64";
        },
      ];
    },
    {
      name: "liquidate";
      docs: [
        "Liquidate an undercollateralized position.",
        "Anyone can call this; seized collateral goes to the insurance fund.",
      ];
      discriminator: [223, 179, 226, 125, 48, 46, 39, 74];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "oracle";
          writable: true;
        },
        {
          name: "vault";
        },
        {
          name: "liquidator";
          docs: [
            "Liquidator receives the rent from the closed position account.",
          ];
          writable: true;
          signer: true;
        },
      ];
      args: [];
    },
    {
      name: "openPosition";
      docs: [
        "Open a leveraged long or short position, depositing native SOL as collateral.",
        "",
        "position_type: 0 = Long, 1 = Short",
        "collateral: lamports to deposit (SOL/lamports, 9 decimals)",
        "leverage: integer multiplier (e.g., 2 = 2x)",
      ];
      discriminator: [135, 128, 47, 77, 15, 152, 240, 49];
      accounts: [
        {
          name: "position";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 111, 115, 105, 116, 105, 111, 110];
              },
              {
                kind: "account";
                path: "trader";
              },
              {
                kind: "arg";
                path: "agentId";
              },
            ];
          };
        },
        {
          name: "trader";
          writable: true;
          signer: true;
        },
        {
          name: "vault";
          docs: ["The vault PDA receives native SOL lamports as collateral."];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
            ];
          };
        },
        {
          name: "oracle";
          writable: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "agentId";
          type: "u32";
        },
        {
          name: "positionType";
          type: "u8";
        },
        {
          name: "collateral";
          type: "u64";
        },
        {
          name: "leverage";
          type: "u64";
        },
      ];
    },
    {
      name: "updateOracle";
      docs: [
        "Push updated TrueSkill ratings from the Dueling system.",
        "Called by the keeper bot after each duel resolves.",
      ];
      discriminator: [112, 41, 209, 18, 248, 226, 252, 188];
      accounts: [
        {
          name: "oracle";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [111, 114, 97, 99, 108, 101];
              },
              {
                kind: "arg";
                path: "agentId";
              },
            ];
          };
        },
        {
          name: "vault";
          docs: [
            "Vault is needed to read skew_scale / funding_velocity during drift update.",
          ];
        },
        {
          name: "authority";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "agentId";
          type: "u32";
        },
        {
          name: "spotIndex";
          type: "u64";
        },
        {
          name: "mu";
          type: "u64";
        },
        {
          name: "sigma";
          type: "u64";
        },
      ];
    },
  ];
  accounts: [
    {
      name: "oracleState";
      discriminator: [97, 156, 157, 189, 194, 73, 8, 15];
    },
    {
      name: "positionState";
      discriminator: [154, 47, 151, 70, 8, 128, 206, 231];
    },
    {
      name: "vaultState";
      discriminator: [228, 196, 82, 165, 98, 210, 235, 152];
    },
  ];
  errors: [
    {
      code: 6000;
      name: "invalidOracle";
      msg: "Oracle does not match the requested agent";
    },
    {
      code: 6001;
      name: "notLiquidatable";
      msg: "Position is not undercollateralized; cannot liquidate";
    },
    {
      code: 6002;
      name: "overflow";
      msg: "Numeric overflow in size calculation";
    },
    {
      code: 6003;
      name: "invalidAuthority";
      msg: "Unauthorized keeper authority";
    },
    {
      code: 6004;
      name: "invalidLeverage";
      msg: "Leverage must be between 1 and 100";
    },
    {
      code: 6005;
      name: "insufficientLiquidity";
      msg: "Vault possesses insufficient liquidity to settle this position";
    },
  ];
  types: [
    {
      name: "oracleState";
      type: {
        kind: "struct";
        fields: [
          {
            name: "agentId";
            type: "u32";
          },
          {
            name: "spotIndex";
            type: "u64";
          },
          {
            name: "mu";
            type: "u64";
          },
          {
            name: "sigma";
            type: "u64";
          },
          {
            name: "lastUpdated";
            type: "i64";
          },
          {
            name: "totalLongOi";
            type: "u64";
          },
          {
            name: "totalShortOi";
            type: "u64";
          },
          {
            name: "currentFundingRate";
            type: "i64";
          },
        ];
      };
    },
    {
      name: "positionState";
      type: {
        kind: "struct";
        fields: [
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "agentId";
            type: "u32";
          },
          {
            name: "positionType";
            type: "u8";
          },
          {
            name: "collateral";
            type: "u64";
          },
          {
            name: "size";
            type: "u64";
          },
          {
            name: "entryPrice";
            type: "u64";
          },
          {
            name: "lastFundingTime";
            type: "i64";
          },
        ];
      };
    },
    {
      name: "vaultState";
      type: {
        kind: "struct";
        fields: [
          {
            name: "authority";
            type: "pubkey";
          },
          {
            name: "insuranceFund";
            type: "u64";
          },
          {
            name: "skewScale";
            type: "u64";
          },
          {
            name: "fundingVelocity";
            type: "u64";
          },
        ];
      };
    },
  ];
};
