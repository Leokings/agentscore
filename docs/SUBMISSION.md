# Portal submission (draft — not submitted)

## Portal note

> AgentScore is a credit score for AI agents built on Internet Court rulings. A GenLayer contract
> reads each ruling from Base and has validators judge what it means (a material loss, a fake
> win); only jury verdicts earn points. It also proves on-chain that wallets share an owner (first
> funding, deployer, Safe operator, found with Nansen), so a loss follows the owner to a new wallet.
> Live on StudioNet: v8.1 judged all 16 ruled cases and proved real links, including a Base
> mainnet link found by Nansen. Two staged abuses were caught: a wallet that won a case against a
> wallet it funded scores D (fake win), and a fresh wallet funded by an agent right after its loss
> inherits that loss (D, not a clean C). Twelve guard transactions fail as expected: replay, forged
> funding direction, faucet as owner, dust, and others. Any agent can check before paying via REST
> or MCP. Limitation: Internet Court's jury relay is down, so the staged cases ended by default
> judgment, not a new jury verdict.

## Evidence

**Contract and source**

- Explorer (contract): https://explorer-studio.genlayer.com/address/0xC7CBE19697ce01581b9F32514014A8ABC0f03A76
- Repository: https://github.com/Leokings/agentscore
- Contract file at the deployed commit: https://github.com/Leokings/agentscore/blob/4b218f21f977101f532ca2fc20738ca04fd9a65e/contracts/agent_score.py
- Release manifest (deployed source identical to that blob; 27/27 steps FINALIZED with the expected leader result): https://github.com/Leokings/agentscore/blob/cfb22a7a50d0801621dcd1a1b518c9c5a6c7e1f5/deployments/studionet/release-manifest.json

**Mechanism (FINALIZED, leader SUCCESS)**

- Deploy: https://explorer-studio.genlayer.com/tx/0x132995c302a7c904450f085d10c1220a1f7b3a613676c1a183e43b4043abe69f
- Judge jury case 15: https://explorer-studio.genlayer.com/tx/0xbe2b5dadf96a248ba90afc27cc1f99ea6ca8f772660383cc12c1c736b185b607
- Judge staged fake-win case 19: https://explorer-studio.genlayer.com/tx/0xb83d8ac03e1feb7f719738d4b40f2105068eb1c4216bc9be932f694af5203724
- Judge staged loss case 20: https://explorer-studio.genlayer.com/tx/0x6ee08958d44c89447b7db30636e3191425b535981130e629d01213feb8114cf1
- Prove link: agent X funded its sock S: https://explorer-studio.genlayer.com/tx/0x2101d4dc5aab9d9096fbefbb3e829068ca59b23349bcf9ccf00f974c5e4c4fb8
- Prove link: the loser funded a successor wallet: https://explorer-studio.genlayer.com/tx/0xb69b3a83598ff226ae537aadab7d70b239675b9154009affd2c8480b659837fc
- Prove Base mainnet link found by Nansen: https://explorer-studio.genlayer.com/tx/0xac5cacddc165992f66d0e8749c16685bcbd265c607f1cbc47c76423bb4dad0bf
- Prove Safe multisig operator: https://explorer-studio.genlayer.com/tx/0x7a6348bbd5a265a0c69c82c2ed9cb2bd56bdc8896c46a4832484915b513b63b8

**Expected failures (FINALIZED, leader ERROR as designed)**

- Replay a judged case: https://explorer-studio.genlayer.com/tx/0xb45aff8ab85b569a405c059c8028bbd65af4f11b19887d180b518b5f98cc1fe6
- Forged funding direction: https://explorer-studio.genlayer.com/tx/0x43f6504d58a8754677d7be9d6f9ed2c99ccad22c1e3f9b54286eedf9ee112dbb
- Faucet claimed as owner: https://explorer-studio.genlayer.com/tx/0xff4b262ffc41bf0539ad58731e593e086dfb409255ccf1813b1c08660c655f6b
- Dust sent first to break an owner link: https://explorer-studio.genlayer.com/tx/0x5b30a33a2f6d18c3a2cf55e3bcb55343000d5e100881e883de2c0839ebe58379
- Cash-out wallet that is infrastructure: https://explorer-studio.genlayer.com/tx/0x9680c8f6630b4a8a9a08f3c0348003351ba252e833afa182f7946c3d51427a8c

**Product**

- Website: https://agentscore-seven.vercel.app
- Report for the fresh wallet that inherits a loss: https://agentscore-seven.vercel.app/agent/0x9c985F2536587966F087E2677c81E386D4AB797c
- Report for the fake-win agent: https://agentscore-seven.vercel.app/agent/0x36b26d2DF45a2838E6Fe0F8B3c97Cd0033A124Cc
- API check: https://agentscore-seven.vercel.app/api/v1/check?wallet=0x36b26d2DF45a2838E6Fe0F8B3c97Cd0033A124Cc&amount=500
- MCP endpoint: https://agentscore-seven.vercel.app/api/mcp
- Skill: https://agentscore-seven.vercel.app/skill.md
- Video (45 s): https://agentscore-seven.vercel.app/video/agentscore-explainer.mp4

All 27 steps, with votes, read-backs and labels, are in the release manifest.
