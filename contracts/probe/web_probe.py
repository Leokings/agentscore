# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Pre-deploy probe: confirms the network accepts the runner and that GenVM can reach the
Base Sepolia RPC (POST) and Blockscout (GET) that AgentScore depends on."""

from genlayer import *
import json

RPC_URL = "https://sepolia.base.org"
FACTORY = "0xd533cb0b52e85b3f506b6f0c28b8f6bc4e449dda"
TX = "0xcb103c14e7867ed94ec1080c036946d6136514a3b6e361158f369b519a3ebfbc"


class WebProbe(gl.Contract):
    rpc_result: str
    blockscout_result: str

    def __init__(self) -> None:
        self.rpc_result = ""
        self.blockscout_result = ""

    @gl.public.write
    def probe(self) -> None:
        def rpc() -> str:
            payload = [{"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": FACTORY, "data": "0xbd14de96" + "0" * 64}, "latest"]}]
            res = gl.nondet.web.post(RPC_URL, body=json.dumps(payload), headers={"Content-Type": "application/json"})
            if res.status != 200:
                return f"status {res.status}"
            items = json.loads((res.body or b"").decode("utf-8"))
            return str(items[0].get("result", items[0].get("error")))

        def blockscout() -> str:
            res = gl.nondet.web.get("https://base-sepolia.blockscout.com/api/v2/transactions/" + TX, headers={"Accept": "application/json"})
            if res.status != 200:
                return f"status {res.status}"
            tx = json.loads((res.body or b"").decode("utf-8"))
            return json.dumps({"from": tx["from"]["hash"].lower(), "nonce": tx["nonce"], "status": tx["status"]}, sort_keys=True)

        self.rpc_result = gl.eq_principle.strict_eq(rpc)
        self.blockscout_result = gl.eq_principle.strict_eq(blockscout)

    @gl.public.view
    def results(self) -> dict[str, str]:
        return {"rpc": self.rpc_result, "blockscout": self.blockscout_result}
