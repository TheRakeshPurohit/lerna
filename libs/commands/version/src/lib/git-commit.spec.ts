import { tempWrite as _tempWrite } from "@lerna/core";
import { EOL } from "os";
import { gitCommit } from "./git-commit";

jest.mock("@lerna/child-process");

jest.mock("@lerna/core", () => ({
  tempWrite: {
    sync: jest.fn(),
  },
  log: jest.requireActual("@lerna/core").log,
}));

const tempWrite = jest.mocked(_tempWrite);

const childProcess = require("@lerna/child-process");

describe("git commit", () => {
  childProcess.exec.mockResolvedValue();
  tempWrite.sync.mockReturnValue("temp-file-path");

  test("--message", async () => {
    const opts = { cwd: "message" };
    await gitCommit("subject", {}, opts);
    expect(childProcess.exec).toHaveBeenLastCalledWith("git", ["commit", "-m", "subject"], opts);
  });

  test("--message <multiline>", async () => {
    const message = `subject${EOL}${EOL}body`;
    const opts = { cwd: "multi-line" };
    await gitCommit(message, {}, opts);
    expect(tempWrite.sync).toHaveBeenLastCalledWith(message, "lerna-commit.txt");
    expect(childProcess.exec).toHaveBeenLastCalledWith("git", ["commit", "-F", "temp-file-path"], opts);
  });

  test("--amend", async () => {
    const opts = { cwd: "no-edit" };
    await gitCommit("whoops", { amend: true }, opts);
    expect(childProcess.exec).toHaveBeenLastCalledWith("git", ["commit", "--amend", "--no-edit"], opts);
  });

  test("--no-commit-hooks", async () => {
    const opts = { cwd: "no-verify" };
    await gitCommit("yolo", { commitHooks: false }, opts);
    expect(childProcess.exec).toHaveBeenLastCalledWith("git", ["commit", "--no-verify", "-m", "yolo"], opts);
  });

  test("--sign-git-commit", async () => {
    const opts = { cwd: "signed" };
    await gitCommit("nice", { signGitCommit: true }, opts);
    expect(childProcess.exec).toHaveBeenLastCalledWith("git", ["commit", "--gpg-sign", "-m", "nice"], opts);
  });

  test("--signoff-git-commit", async () => {
    const opts = { cwd: "signed-off" };
    await gitCommit("nice", { signoffGitCommit: true }, opts);
    expect(childProcess.exec).toHaveBeenLastCalledWith("git", ["commit", "--signoff", "-m", "nice"], opts);
  });
});
