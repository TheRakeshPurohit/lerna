// Plugin isolation is not relevant to lerna
process.env["NX_ISOLATE_PLUGINS"] = "false";
// If plugin isolation is off, also make sure we're not using the legacy peer deps behavior.
// See: https://github.com/lerna/lerna/issues/4167
// This could be removed if Nx is not setting this to true by default.
process.env["npm_config_legacy_peer_deps"] ??= "false";

import dedent from "dedent";
import os from "node:os";
import yargs from "yargs";
import log from "./npmlog";

/**
 * A factory that returns a yargs() instance configured with everything except commands.
 * Chain .parse() from this method to invoke.
 */
export function lernaCLI(argv?: string | readonly string[], cwd?: string) {
  const cli = yargs(argv, cwd);

  return globalOptions(cli)
    .usage("Usage: $0 <command> [options]")
    .demandCommand(1, "A command is required. Pass --help to see all available commands and options.")
    .recommendCommands()
    .strict()
    .fail((msg, err: any) => {
      // certain yargs validations throw strings :P
      const actual = err || new Error(msg);

      // ValidationErrors are already logged, as are package errors
      if (actual.name !== "ValidationError" && !actual.pkg) {
        // the recommendCommands() message is too terse
        if (/Did you mean/.test(actual.message)) {
          // TODO: refactor to address type issues
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          log.error("lerna", `Unknown command "${cli.parsed.argv._[0]}"`);
        }

        log.error("lerna", actual.message);
      }

      // exit non-zero so the CLI can be usefully chained
      cli.exit(actual.exitCode > 0 ? actual.exitCode : 1, actual);
    })
    .alias("h", "help")
    .alias("v", "version")
    .wrap(cli.terminalWidth()).epilogue(dedent`
      When a command fails, all logs are written to lerna-debug.log in the current working directory.

      For more information, check out the docs at https://lerna.js.org/docs/introduction
    `);
}

function globalOptions(argv: yargs.Argv) {
  // the global options applicable to _every_ command
  const opts: { [key: string]: yargs.Options } = {
    loglevel: {
      defaultDescription: "info",
      describe: "What level of logs to report.",
      type: "string",
    },
    concurrency: {
      defaultDescription: String(os.cpus().length),
      describe: "How many processes to use when lerna parallelizes tasks.",
      type: "number",
      requiresArg: true,
    },
    "reject-cycles": {
      describe: "Fail if a cycle is detected among dependencies.",
      type: "boolean",
    },
    "no-progress": {
      describe: "Disable progress bars. (Always off in CI)",
      type: "boolean",
    },
    progress: {
      // proxy for --no-progress
      hidden: true,
      type: "boolean",
    },
    "no-sort": {
      describe: "Do not sort packages topologically (dependencies before dependents).",
      type: "boolean",
    },
    sort: {
      // proxy for --no-sort
      hidden: true,
      type: "boolean",
    },
    "max-buffer": {
      describe: "Set max-buffer (in bytes) for subcommand execution",
      type: "number",
      requiresArg: true,
    },
  };

  // group options under "Global Options:" header
  const globalKeys = Object.keys(opts).concat(["help", "version"]);

  return argv.options(opts).group(globalKeys, "Global Options:").option("ci", {
    hidden: true,
    type: "boolean",
  });
}
