// Serves the snapshot-backed tools from committed fixtures, with no DF and no Docker (#161).
//   npm run start:stub                     # the committed fixtures
//   npm run start:stub -- --fixture <dir>   # a capture of your own
// Tools with no snapshot path still report that DFHack cannot be reached.
// See docs/snapshot.md, "Off-game development".
import process from 'node:process';

const argv = process.argv.slice(2);
const at = argv.indexOf('--fixture');
const dir = at === -1 ? undefined : argv[at + 1];
if (at !== -1 && !dir) {
  console.error('--fixture needs a directory');
  process.exit(2);
}

process.env.DFHACK_MCP_SNAPSHOT = '1';
process.env.DFHACK_MCP_SNAPSHOT_FIXTURE =
  dir ?? process.env.DFHACK_MCP_SNAPSHOT_FIXTURE ?? 'test/fixtures/snapshot';

const { fixtureProvenance } = await import('../src/snapshotFixture.ts');
const served = process.env.DFHACK_MCP_SNAPSHOT_FIXTURE;
for (const walker of ['entities', 'map']) {
  let p;
  try {
    p = fixtureProvenance(walker, served);
  } catch (err) {
    console.error(`cannot serve ${walker}: ${err.message}`);
    process.exit(1);
  }
  // stderr, never stdout: stdout is the MCP stream.
  console.error(
    `${walker}: ${p.save_folder} on DF ${p.df_version} / DFHack ${p.dfhack_version} (${served})`
  );
}

await import('../src/index.ts');
