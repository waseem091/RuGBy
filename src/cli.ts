#!/usr/bin/env node
import { Command } from "commander";
import { writeAllRgbFixture } from "./fixture.js";
import { VERSION } from "./version.js";

const program = new Command();
program
  .name("rugby")
  .description("Audit the colors a browser actually paints: contrast and design-token drift.")
  .version(VERSION);

program
  .command("fixture")
  .description("regenerate the lossless all-RGB test PNG (fixtures/allrgb.png)")
  .option("-o, --out <path>", "output path", "fixtures/allrgb.png")
  .action(async (opts: { out: string }) => {
    const path = await writeAllRgbFixture(opts.out);
    process.stdout.write(`wrote ${path}\n`);
  });

await program.parseAsync(process.argv);
