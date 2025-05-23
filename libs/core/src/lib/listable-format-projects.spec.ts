/* eslint-disable @nx/enforce-module-boundaries */
// nx-ignore-next-line
import { loggingOutput, tempDirSerializer, windowsPathSerializer } from "@lerna/test-helpers";
import chalk from "chalk";
import tempy from "tempy";
import { formatJSON, listableFormatProjects } from "./listable-format-projects";
import { ListableOptions } from "./listable-options";
import { Package, RawManifest } from "./package";
import {
  ProjectGraphProjectNodeWithPackage,
  ProjectGraphWithPackages,
  ProjectGraphWorkspacePackageDependency,
} from "./project-graph-with-packages";
import { createProjectGraph, projectGraphDependency } from "./test-helpers/create-project-graph";

// keep snapshots stable cross-platform
chalk.level = 0;

// remove quotes around top-level strings
expect.addSnapshotSerializer({
  test(val) {
    return typeof val === "string";
  },
  serialize(val, config, indentation, depth) {
    // top-level strings don't need quotes, but nested ones do (object properties, etc)
    return depth ? `"${val}"` : val;
  },
});

// normalize temp directory paths in snapshots
// nx-ignore-next-line
expect.addSnapshotSerializer(windowsPathSerializer);
// nx-ignore-next-line
expect.addSnapshotSerializer(tempDirSerializer);

describe("listableFormatProjects", () => {
  let projectNodes: ProjectGraphProjectNodeWithPackage[];
  let projectGraph: ProjectGraphWithPackages;

  const formatWithOptions = (opts: ListableOptions) =>
    listableFormatProjects(projectNodes, projectGraph, { _: ["ls"], ...opts });

  beforeAll(() => {
    const cwd = tempy.directory();
    process.chdir(cwd);

    projectNodes = createProjectNodes(cwd);
    projectGraph = createProjectGraph({ projects: projectNodes, dependencies: createDependencies() });
  });

  describe("renders", () => {
    test("all output", () => {
      const { count, text } = formatWithOptions({ all: true });

      expect(count).toBe(3);
      expect(text).toMatchInlineSnapshot(`
pkg-1
pkg-2
pkg-3 (PRIVATE)
`);
    });

    test("long output", () => {
      const { count, text } = formatWithOptions({ long: true });

      expect(count).toBe(2);
      expect(text).toMatchInlineSnapshot(`
pkg-1  v1.0.0 pkgs/pkg-1
pkg-2 MISSING pkgs/pkg-2
`);
    });

    test("all long output", () => {
      const { text } = formatWithOptions({ long: true, all: true });

      expect(text).toMatchInlineSnapshot(`
pkg-1  v1.0.0 pkgs/pkg-1
pkg-2 MISSING pkgs/pkg-2
pkg-3  v3.0.0 pkgs/pkg-3 (PRIVATE)
`);
    });

    test("JSON output", () => {
      const { text } = formatWithOptions({ json: true });

      expect(text).toMatchInlineSnapshot(`
[
  {
    "name": "pkg-1",
    "version": "1.0.0",
    "private": false,
    "location": "__TEST_ROOTDIR__/pkgs/pkg-1"
  },
  {
    "name": "pkg-2",
    "private": false,
    "location": "__TEST_ROOTDIR__/pkgs/pkg-2"
  }
]
`);
    });

    test("JSON output with additional props", () => {
      const text = formatJSON(projectNodes, ({ name }) => ({ projectName: name }));

      expect(text).toMatchInlineSnapshot(`
[
  {
    "name": "pkg-1",
    "version": "1.0.0",
    "private": false,
    "location": "__TEST_ROOTDIR__/pkgs/pkg-1",
    "projectName": "pkg-1"
  },
  {
    "name": "pkg-2",
    "private": false,
    "location": "__TEST_ROOTDIR__/pkgs/pkg-2",
    "projectName": "pkg-2"
  },
  {
    "name": "pkg-3",
    "version": "3.0.0",
    "private": true,
    "location": "__TEST_ROOTDIR__/pkgs/pkg-3",
    "projectName": "pkg-3"
  }
]
`);
    });

    test("all JSON output", () => {
      const { text } = formatWithOptions({ json: true, all: true });

      expect(text).toMatchInlineSnapshot(`
[
  {
    "name": "pkg-1",
    "version": "1.0.0",
    "private": false,
    "location": "__TEST_ROOTDIR__/pkgs/pkg-1"
  },
  {
    "name": "pkg-2",
    "private": false,
    "location": "__TEST_ROOTDIR__/pkgs/pkg-2"
  },
  {
    "name": "pkg-3",
    "version": "3.0.0",
    "private": true,
    "location": "__TEST_ROOTDIR__/pkgs/pkg-3"
  }
]
`);
    });

    test("NDJSON output", () => {
      const { text } = formatWithOptions({ ndjson: true, all: true });

      expect(text).toMatchInlineSnapshot(`
{"name":"pkg-1","version":"1.0.0","private":false,"location":"__TEST_ROOTDIR__/pkgs/pkg-1"}
{"name":"pkg-2","private":false,"location":"__TEST_ROOTDIR__/pkgs/pkg-2"}
{"name":"pkg-3","version":"3.0.0","private":true,"location":"__TEST_ROOTDIR__/pkgs/pkg-3"}
`);
    });

    test("graph output", () => {
      const { text } = formatWithOptions({ graph: true });

      expect(text).toMatchInlineSnapshot(`
        {
          "pkg-1": [
            "pkg-2"
          ],
          "pkg-2": []
        }
      `);
    });

    test("all graph output", () => {
      const { text } = formatWithOptions({ graph: true, all: true });

      expect(text).toMatchInlineSnapshot(`
        {
          "pkg-1": [
            "pkg-2"
          ],
          "pkg-2": [
            "pkg-3"
          ],
          "pkg-3": [
            "pkg-2"
          ]
        }
      `);
    });

    test("parseable output", () => {
      const { text } = formatWithOptions({ parseable: true });

      expect(text).toMatchInlineSnapshot(`
__TEST_ROOTDIR__/pkgs/pkg-1
__TEST_ROOTDIR__/pkgs/pkg-2
`);
    });

    test("all parseable output", () => {
      const { text } = formatWithOptions({ parseable: true, all: true });

      expect(text).toMatchInlineSnapshot(`
__TEST_ROOTDIR__/pkgs/pkg-1
__TEST_ROOTDIR__/pkgs/pkg-2
__TEST_ROOTDIR__/pkgs/pkg-3
`);
    });

    test("long parseable output", () => {
      const { text } = formatWithOptions({ parseable: true, long: true });

      expect(text).toMatchInlineSnapshot(`
__TEST_ROOTDIR__/pkgs/pkg-1:pkg-1:1.0.0
__TEST_ROOTDIR__/pkgs/pkg-2:pkg-2:MISSING
`);
    });

    test("all long parseable output", () => {
      const { text } = formatWithOptions({ parseable: true, all: true, long: true });

      expect(text).toMatchInlineSnapshot(`
__TEST_ROOTDIR__/pkgs/pkg-1:pkg-1:1.0.0
__TEST_ROOTDIR__/pkgs/pkg-2:pkg-2:MISSING
__TEST_ROOTDIR__/pkgs/pkg-3:pkg-3:3.0.0:PRIVATE
`);
    });
  });

  describe("aliases", () => {
    test("la => ls -la", () => {
      const { text } = formatWithOptions({ _: ["la"] });

      expect(text).toMatchInlineSnapshot(`
pkg-1  v1.0.0 pkgs/pkg-1
pkg-2 MISSING pkgs/pkg-2
pkg-3  v3.0.0 pkgs/pkg-3 (PRIVATE)
`);
    });

    test("ll => ls -l", () => {
      const { text } = formatWithOptions({ _: ["ll"] });

      expect(text).toMatchInlineSnapshot(`
pkg-1  v1.0.0 pkgs/pkg-1
pkg-2 MISSING pkgs/pkg-2
`);
    });
  });

  describe("toposort", () => {
    test("output", () => {
      const { text } = formatWithOptions({ toposort: true });

      expect(text).toMatchInlineSnapshot(`
pkg-2
pkg-1
`);
    });

    test("cycles", () => {
      const { text } = formatWithOptions({ toposort: true, all: true });

      expect(loggingOutput("warn")).toContainEqual(expect.stringContaining("pkg-2 -> pkg-3 -> pkg-2"));
      expect(text).toMatchInlineSnapshot(`
pkg-2
pkg-3 (PRIVATE)
pkg-1
`);
    });
  });
});

const createProjectNodes = (cwd: string): ProjectGraphProjectNodeWithPackage[] => [
  {
    name: "pkg-1",
    type: "lib",
    data: {
      root: `${cwd}/pkgs/pkg-1`,
    },
    package: new Package(
      {
        name: "pkg-1",
        version: "1.0.0",
        dependencies: { "pkg-2": "file:../pkg-2" },
      },
      `${cwd}/pkgs/pkg-1`,
      cwd
    ),
  },
  {
    name: "pkg-2",
    type: "lib",
    data: {
      root: `${cwd}/pkgs/pkg-2`,
    },
    package: new Package(
      {
        name: "pkg-2",
        devDependencies: { "pkg-3": "file:../pkg-3" },
      } as unknown as RawManifest,
      `${cwd}/pkgs/pkg-2`,
      cwd
    ),
  },
  {
    name: "pkg-3",
    type: "lib",
    data: {
      root: `${cwd}/pkgs/pkg-3`,
    },
    package: new Package(
      {
        name: "pkg-3",
        version: "3.0.0",
        private: true,
        dependencies: { "pkg-2": "file:../pkg-2" },
      },
      `${cwd}/pkgs/pkg-3`,
      cwd
    ),
  },
];

const createDependencies = (): ProjectGraphWorkspacePackageDependency[] => [
  projectGraphDependency({
    source: "pkg-1",
    target: "pkg-2",
    targetVersionMatchesDependencyRequirement: true,
  }),
  projectGraphDependency({
    source: "pkg-2",
    target: "pkg-3",
    targetVersionMatchesDependencyRequirement: true,
  }),
  projectGraphDependency({
    source: "pkg-3",
    target: "pkg-2",
    targetVersionMatchesDependencyRequirement: true,
  }),
];
