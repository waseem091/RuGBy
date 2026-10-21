/**
 * Regenerate fixtures/allrgb.png. The same code backs `rugby fixture`;
 * after `npm run build` you can also run `node dist/cli.js fixture`.
 */
import { writeAllRgbFixture } from "../src/fixture.js";

const out = await writeAllRgbFixture(process.argv[2]);
console.log(`wrote ${out}`);
