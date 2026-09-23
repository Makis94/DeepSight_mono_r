import { describe, expect, it } from "vitest";
import {
  AGENT_NAME,
  buildApproveAgentAction,
  buildApproveAgentTypedData,
  USER_SIGNED_ACTION_SIGNATURE_CHAIN_ID,
} from "./signing.js";

describe("buildApproveAgentAction", () => {
  it("uses the reference SDK's fixed signatureChainId, not the exchange-endpoint doc's illustrative example", () => {
    const action = buildApproveAgentAction(
      "0xABCDEF0123456789abcdef0123456789ABCDEF01",
      1_700_000_000_000,
      true,
    );
    expect(action.signatureChainId).toBe("0x66eee");
    expect(USER_SIGNED_ACTION_SIGNATURE_CHAIN_ID).toBe("0x66eee");
  });

  it("maps isMainnet to the exact 'Mainnet'/'Testnet' strings Hyperliquid expects", () => {
    expect(buildApproveAgentAction("0x00", 1, true).hyperliquidChain).toBe("Mainnet");
    expect(buildApproveAgentAction("0x00", 1, false).hyperliquidChain).toBe("Testnet");
  });

  it("lowercases the agent address", () => {
    const action = buildApproveAgentAction("0xABCDEF0123456789abcdef0123456789ABCDEF01", 1, true);
    expect(action.agentAddress).toBe("0xabcdef0123456789abcdef0123456789abcdef01");
  });

  it("uses a fixed, named agent (not the account's single unnamed slot)", () => {
    const action = buildApproveAgentAction("0x00", 1, true);
    expect(action.agentName).toBe(AGENT_NAME);
    expect(action.agentName.length).toBeGreaterThan(0);
  });

  it("round-trips the nonce and sets the correct action type tag", () => {
    const action = buildApproveAgentAction("0x00", 1_700_000_000_000, true);
    expect(action.nonce).toBe(1_700_000_000_000);
    expect(action.type).toBe("approveAgent");
  });
});

describe("buildApproveAgentTypedData", () => {
  const action = buildApproveAgentAction(
    "0xabcdef0123456789abcdef0123456789abcdef01",
    1_700_000_000_000,
    true,
  );
  const typedData = buildApproveAgentTypedData(action);

  it("uses the exact domain the reference SDK's user_signed_payload() constructs", () => {
    expect(typedData.domain).toEqual({
      name: "HyperliquidSignTransaction",
      version: "1",
      // parseInt("0x66eee", 16)
      chainId: 421_614,
      verifyingContract: "0x0000000000000000000000000000000000000000",
    });
  });

  it("uses the exact primaryType and field list/order the reference SDK's sign_agent() specifies", () => {
    expect(typedData.primaryType).toBe("HyperliquidTransaction:ApproveAgent");
    expect(typedData.types["HyperliquidTransaction:ApproveAgent"]).toEqual([
      { name: "hyperliquidChain", type: "string" },
      { name: "agentAddress", type: "address" },
      { name: "agentName", type: "string" },
      { name: "nonce", type: "uint64" },
    ]);
  });

  it("passes the full action through as the message (extra fields are harmless per EIP-712)", () => {
    expect(typedData.message).toEqual(action);
  });

  it("includes an explicit EIP712Domain type — required by eth_signTypedData_v4 wallets that don't auto-inject it (code-review, 2026-09-23)", () => {
    expect(typedData.types.EIP712Domain).toEqual([
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ]);
  });
});
