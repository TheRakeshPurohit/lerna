import log from "./npmlog";

const childProcess = require("@lerna/child-process");

interface DescribeRefOptions {
  // Defaults to `process.cwd()`
  cwd?: string | URL;
  // Glob passed to `--match` flag
  match?: string;
  // Separator used within independent version tags, defaults to @
  separator?: string;
}

// When annotated release tags are missing
export interface DescribeRefFallbackResult {
  isDirty: boolean;
  refCount: string;
  sha: string;
}

// When annotated release tags are present
export interface DescribeRefDetailedResult extends DescribeRefFallbackResult {
  lastTagName: string;
  lastVersion: string;
}

/**
 * Build `git describe` args.
 */
function getArgs(options: DescribeRefOptions, includeMergedTags = false): string[] {
  let args = [
    "describe",
    // fallback to short sha if no tags located
    "--always",
    // always return full result, helps identify existing release
    "--long",
    // annotate if uncommitted changes present
    "--dirty",
    // prefer tags originating on upstream branch
    "--first-parent",
  ];

  if (options.match) {
    args.push("--match", options.match);
  }

  if (includeMergedTags) {
    // we want to consider all tags, also from merged branches
    args = args.filter((arg) => arg !== "--first-parent");
  }

  return args;
}

export function describeRef(
  options: DescribeRefOptions = {},
  includeMergedTags?: boolean
): Promise<DescribeRefFallbackResult | DescribeRefDetailedResult> {
  const promise = childProcess.exec("git", getArgs(options, includeMergedTags), options);

  return promise.then(({ stdout }: { stdout: string }) => {
    // TODO: refactor based on TS feedback
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const result = parse(stdout, options.cwd, options.separator);

    log.verbose("git-describe", "%j => %j", options && options.match, stdout);
    log.silly("git-describe", "parsed => %j", result);

    return result;
  });
}

export function describeRefSync(
  options: DescribeRefOptions = {},
  includeMergedTags?: boolean
): DescribeRefFallbackResult | DescribeRefDetailedResult {
  const stdout = childProcess.execSync("git", getArgs(options, includeMergedTags), options);
  // TODO: refactor based on TS feedback
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const result = parse(stdout, options.cwd, options.separator);

  // only called by collect-updates with no matcher
  log.silly("git-describe.sync", "%j => %j", stdout, result);

  return result;
}

/**
 * Parse git output and return relevant metadata.
 * @param stdout Result of `git describe`
 * @param [cwd] Defaults to `process.cwd()`
 * @param [separator] Separator used within independent version tags, defaults to @
 */
function parse(
  stdout: string,
  cwd: string,
  separator: string
): DescribeRefFallbackResult | DescribeRefDetailedResult {
  separator = separator || "@";

  const minimalShaRegex = /^([0-9a-f]{7,40})(-dirty)?$/;
  // when git describe fails to locate tags, it returns only the minimal sha
  if (minimalShaRegex.test(stdout)) {
    // repo might still be dirty
    // TODO: refactor based on TS feedback
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const [, sha, isDirty] = minimalShaRegex.exec(stdout);

    // count number of commits since beginning of time
    const refCount = childProcess.execSync("git", ["rev-list", "--count", sha], { cwd });

    return { refCount, sha, isDirty: Boolean(isDirty) };
  }

  // If the user has specified a custom separator, it may not be regex-safe, so escape it
  const escapedSeparator = separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexPattern = new RegExp(`^((?:.*${escapedSeparator})?(.*))-(\\d+)-g([0-9a-f]+)(-dirty)?$`);

  const [, lastTagName, lastVersion, refCount, sha, isDirty] = regexPattern.exec(stdout) || [];

  return { lastTagName, lastVersion, refCount, sha, isDirty: Boolean(isDirty) };
}
