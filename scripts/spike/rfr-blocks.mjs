import { performance } from 'node:perf_hooks';
import { DwarfClient, METHODS } from 'dfhack-remote-node';

METHODS.GetBlockList = {
  plugin: 'RemoteFortressReader',
  input: 'RemoteFortressReader.BlockRequest',
  output: 'RemoteFortressReader.BlockList',
};
METHODS.ResetMapHashes = {
  plugin: 'RemoteFortressReader',
  input: 'dfproto.EmptyMessage',
  output: 'dfproto.EmptyMessage',
};

const client = new DwarfClient({
  host: process.env.DFHACK_HOST ?? '127.0.0.1',
  port: Number(process.env.DFHACK_PORT ?? 5000),
});
await client.connect();

const info = await client.call('GetMapInfo');
const bx = info.blockSizeX;
const by = info.blockSizeY;
const bz = info.blockSizeZ;
console.log(`map ${bx}x${by}x${bz} blocks (${bx * by * bz})`);

async function pass(label, zStep) {
  await client.call('ResetMapHashes');
  let blocks = 0;
  let tiles = 0;
  let maxCall = 0;
  const t0 = performance.now();
  for (let z = 0; z < bz; z += zStep) {
    const c0 = performance.now();
    const out = await client.call('GetBlockList', {
      blocksNeeded: 1_000_000,
      minX: 0,
      maxX: bx,
      minY: 0,
      maxY: by,
      minZ: z,
      maxZ: Math.min(z + zStep, bz),
      forceReload: true,
    });
    maxCall = Math.max(maxCall, performance.now() - c0);
    for (const b of out.mapBlocks ?? []) {
      blocks++;
      tiles += b.tiles?.length ?? 0;
    }
  }
  const ms = performance.now() - t0;
  console.log(
    `${label.padEnd(22)} ${blocks} blocks, ${tiles} tiles in ${ms.toFixed(0)} ms ` +
      `(${((ms * 1000) / Math.max(blocks, 1)).toFixed(0)} µs/block incl. decode), slowest call ${maxCall.toFixed(0)} ms`
  );
}

await pass('one z-level per call', 1);
await pass('16 z-levels per call', 16);
client.close();
