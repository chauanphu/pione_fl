
1. Reset the data: rm -rf ./data
2. Re-initialize with the updated genesis file:
```bash
geth --datadir ./data init genesis.json
```
3. Start geth:
```bash
geth --datadir ./data --networkid 12345 \
--http --http.addr "0.0.0.0" --http.api "eth,net,web3,personal" \
--unlock "YOUR_ACCOUNT_ADDRESS" --password ./password.txt \
--mine console
```