import { Package, ValidationError } from "@lerna/core";
import npa from "npm-package-arg";
import { CyclicPackageGraphNode } from "./cyclic-package-graph-node";
import { PackageGraphNode } from "./package-graph-node";
import { reportCycles } from "./report-cycles";

/**
 * A graph of packages in the current project.
 */
export class PackageGraph extends Map<string, PackageGraphNode> {
  /**
   * @param {import("@lerna/package").Package[]} packages An array of Packages to build the graph out of.
   * @param {'allDependencies'|'dependencies'} [graphType]
   *    Pass "dependencies" to create a graph of only dependencies,
   *    excluding the devDependencies that would normally be included.
   * @param {boolean} [forceLocal] Force all local dependencies to be linked.
   */
  constructor(
    packages: Package[],
    graphType: "allDependencies" | "dependencies" = "allDependencies",
    forceLocal?: boolean
  ) {
    super(packages.map((pkg) => [pkg.name, new PackageGraphNode(pkg)]));

    if (packages.length !== this.size) {
      // weed out the duplicates
      const seen = new Map();

      for (const { name, location } of packages) {
        if (seen.has(name)) {
          seen.get(name).push(location);
        } else {
          seen.set(name, [location]);
        }
      }

      for (const [name, locations] of seen) {
        if (locations.length > 1) {
          throw new ValidationError(
            "ENAME",
            [`Package name "${name}" used in multiple packages:`, ...locations].join("\n\t")
          );
        }
      }
    }

    this.forEach((currentNode, currentName) => {
      const graphDependencies =
        graphType === "dependencies"
          ? Object.assign({}, currentNode.pkg.optionalDependencies, currentNode.pkg.dependencies)
          : Object.assign(
              {},
              currentNode.pkg.devDependencies,
              currentNode.pkg.optionalDependencies,
              currentNode.pkg.dependencies
            );

      // TODO: refactor to address type issues
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      Object.keys(graphDependencies).forEach((depName) => {
        const depNode = this.get(depName);
        // Yarn decided to ignore https://github.com/npm/npm/pull/15900 and implemented "link:"
        // As they apparently have no intention of being compatible, we have to do it for them.
        // @see https://github.com/yarnpkg/yarn/issues/4212
        let spec = graphDependencies[depName].replace(/^link:/, "file:");

        // Support workspace: protocol for pnpm and yarn 2+ (https://pnpm.io/workspaces#workspace-protocol-workspace)
        const isWorkspaceSpec = /^workspace:/.test(spec);

        let fullWorkspaceSpec;
        let workspaceAlias;
        if (isWorkspaceSpec) {
          fullWorkspaceSpec = spec;
          spec = spec.replace(/^workspace:/, "");

          // replace aliases (https://pnpm.io/workspaces#referencing-workspace-packages-through-aliases)
          if (spec === "*" || spec === "^" || spec === "~") {
            workspaceAlias = spec;
            if (depNode?.version) {
              const prefix = spec === "*" ? "" : spec;
              const version = depNode.version;
              spec = `${prefix}${version}`;
            } else {
              spec = "*";
            }
          }
        }

        const resolved = npa.resolve(depName, spec, currentNode.location);
        // TODO: refactor to address type issues
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        resolved.workspaceSpec = fullWorkspaceSpec;
        // TODO: refactor to address type issues
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        resolved.workspaceAlias = workspaceAlias;

        if (!depNode) {
          // it's an external dependency, store the resolution and bail
          return currentNode.externalDependencies.set(depName, resolved);
        }

        if (forceLocal || resolved.fetchSpec === depNode.location || depNode.satisfies(resolved)) {
          // a local file: specifier OR a matching semver
          currentNode.localDependencies.set(depName, resolved);
          depNode.localDependents.set(currentName, currentNode);
        } else {
          if (isWorkspaceSpec) {
            // pnpm refuses to resolve remote dependencies when using the workspace: protocol, so lerna does too. See: https://pnpm.io/workspaces#workspace-protocol-workspace.
            throw new ValidationError(
              "EWORKSPACE",
              `Package specification "${depName}@${spec}" could not be resolved within the workspace. To reference a non-matching, remote version of a local dependency, remove the 'workspace:' prefix.`
            );
          }

          // non-matching semver of a local dependency
          currentNode.externalDependencies.set(depName, resolved);
        }
      });
    });
  }

  get rawPackageList() {
    return Array.from(this.values()).map((node) => node.pkg);
  }

  /**
   * Takes a list of Packages and returns a list of those same Packages with any Packages
   * they depend on. i.e if packageA depended on packageB `graph.addDependencies([packageA])`
   * would return [packageA, packageB].
   *
   * @param filteredPackages The packages to include dependencies for.
   */
  addDependencies(filteredPackages: Package[]) {
    return this.extendList(filteredPackages, "localDependencies");
  }

  /**
   * Takes a list of Packages and returns a list of those same Packages with any Packages
   * that depend on them. i.e if packageC depended on packageD `graph.addDependents([packageD])`
   * would return [packageD, packageC].
   *
   * @param filteredPackages The packages to include dependents for.
   */
  addDependents(filteredPackages: Package[]) {
    return this.extendList(filteredPackages, "localDependents");
  }

  /**
   * Extends a list of packages by traversing on a given property, which must refer to a
   * `PackageGraphNode` property that is a collection of `PackageGraphNode`s.
   * Returns input packages with any additional packages found by traversing `nodeProp`.
   *
   * @param packageList The list of packages to extend
   * @param nodeProp The property on `PackageGraphNode` used to traverse
   */
  extendList(packageList: Package[], nodeProp: "localDependencies" | "localDependents") {
    // the current list of packages we are expanding using breadth-first-search
    const search = new Set(packageList.map(({ name }) => this.get(name)));

    // an intermediate list of matched PackageGraphNodes
    const result: PackageGraphNode[] = [];

    search.forEach((currentNode) => {
      // anything searched for is always a result
      // TODO: refactor to address type issues
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      result.push(currentNode);

      // TODO: refactor to address type issues
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      currentNode[nodeProp].forEach((meta, depName) => {
        const depNode = this.get(depName);

        if (depNode !== currentNode && !search.has(depNode)) {
          search.add(depNode);
        }
      });
    });

    // actual Package instances, not PackageGraphNodes
    return result.map((node) => node.pkg);
  }

  /**
   * Return a tuple of cycle paths and nodes.
   *
   * @deprecated Use collapseCycles instead.
   *
   * @param  rejectCycles Whether or not to reject cycles
   */
  partitionCycles(rejectCycles: boolean): [Set<string[]>, Set<PackageGraphNode>] {
    const cyclePaths = new Set<string[]>();
    const cycleNodes = new Set<PackageGraphNode>();

    this.forEach((currentNode, currentName) => {
      const seen = new Set();

      const visits =
        (walk: string[]) =>
        (
          dependentNode: PackageGraphNode,
          dependentName: string,
          siblingDependents: Map<string, PackageGraphNode>
        ) => {
          const step = walk.concat(dependentName);

          if (seen.has(dependentNode)) {
            return;
          }

          seen.add(dependentNode);

          if (dependentNode === currentNode) {
            // a direct cycle
            cycleNodes.add(currentNode);
            cyclePaths.add(step);

            return;
          }

          if (siblingDependents.has(currentName)) {
            // a transitive cycle
            const cycleDependentName = Array.from(dependentNode.localDependencies.keys()).find((key) =>
              currentNode.localDependents.has(key)
            );
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const pathToCycle = step.slice().reverse().concat(cycleDependentName!);

            cycleNodes.add(dependentNode);
            cyclePaths.add(pathToCycle);
          }

          dependentNode.localDependents.forEach(visits(step));
        };

      currentNode.localDependents.forEach(visits([currentName]));
    });

    reportCycles(
      Array.from(cyclePaths, (cycle) => cycle.join(" -> ")),
      rejectCycles
    );

    return [cyclePaths, cycleNodes];
  }

  /**
   * Returns the cycles of this graph. If two cycles share some elements, they will
   * be returned as a single cycle.
   *
   * @param {boolean} rejectCycles Whether or not to reject cycles
   * @returns {Set<CyclicPackageGraphNode>}
   */
  collapseCycles(rejectCycles?: boolean): Set<CyclicPackageGraphNode> {
    const cyclePaths: string[] = [];
    const nodeToCycle = new Map<PackageGraphNode, CyclicPackageGraphNode>();
    const cycles = new Set<CyclicPackageGraphNode>();
    const walkStack: (PackageGraphNode | CyclicPackageGraphNode)[] = [];
    const alreadyVisited = new Set<PackageGraphNode>();

    function visits(baseNode: PackageGraphNode, dependentNode: any) {
      if (nodeToCycle.has(baseNode)) {
        return;
      }

      let topLevelDependent = dependentNode;
      while (nodeToCycle.has(topLevelDependent)) {
        topLevelDependent = nodeToCycle.get(topLevelDependent);
      }

      // Otherwise the same node is checked multiple times which is very wasteful in a large repository
      const identifier = `${baseNode.name}:${topLevelDependent.name}`;
      // TODO: refactor to address type issues
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (alreadyVisited.has(identifier)) {
        return;
      }
      // TODO: refactor to address type issues
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      alreadyVisited.add(identifier);

      if (
        topLevelDependent === baseNode ||
        (topLevelDependent.isCycle && topLevelDependent.has(baseNode.name))
      ) {
        const cycle = new CyclicPackageGraphNode();

        walkStack.forEach((nodeInCycle) => {
          // TODO: refactor to address type issues
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          nodeToCycle.set(nodeInCycle, cycle);
          cycle.insert(nodeInCycle);
          // TODO: refactor to address type issues
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          cycles.delete(nodeInCycle);
        });

        cycles.add(cycle);
        cyclePaths.push(cycle.toString());

        return;
      }

      if (walkStack.indexOf(topLevelDependent) === -1) {
        visitWithStack(baseNode, topLevelDependent);
      }
    }

    // TODO: refactor to address type issues
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    function visitWithStack(baseNode, currentNode = baseNode) {
      walkStack.push(currentNode);
      currentNode.localDependents.forEach(visits.bind(null, baseNode));
      walkStack.pop();
    }

    this.forEach((currentNode) => visitWithStack(currentNode));
    cycles.forEach((collapsedNode) => visitWithStack(collapsedNode));

    reportCycles(cyclePaths, rejectCycles);

    return cycles;
  }

  /**
   * Remove cycle nodes.
   *
   * @deprecated Spread set into prune() instead.
   */
  pruneCycleNodes(cycleNodes: Set<PackageGraphNode>) {
    return this.prune(...cycleNodes);
  }

  /**
   * Remove all candidate nodes.
   */
  prune(...candidates: PackageGraphNode[]) {
    if (candidates.length === this.size) {
      return this.clear();
    }

    candidates.forEach((node) => this.remove(node));
  }

  /**
   * Delete by value (instead of key), as well as removing pointers
   * to itself in the other node's internal collections.
   * @param candidateNode instance to remove
   */
  remove(candidateNode: PackageGraphNode) {
    this.delete(candidateNode.name);

    this.forEach((node) => {
      // remove incoming edges ("indegree")
      node.localDependencies.delete(candidateNode.name);

      // remove outgoing edges ("outdegree")
      node.localDependents.delete(candidateNode.name);
    });
  }
}
