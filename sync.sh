#! /bin/bash

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
export BUN_INSTALL="$HOME/.bun"
export PATH=$BUN_INSTALL/bin:$PATH

cd /home/opc/irdesi-inscricao-sync
DATE=$(date +%Y%m%d_%H%M%S)
#npm run start | bzip2 -c > /home/opc/logs/irdesi-inscricao-sync-${DATE}.log.bz2
bun run src/index.ts | bzip2 -c > /home/opc/logs/irdesi-inscricao-sync-${DATE}.log.bz2

