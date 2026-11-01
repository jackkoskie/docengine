# Releasing docengine

Publication is manual. Before the first release:

1. Confirm control of the `@jackkoskie` npm scope and availability of both package names. Configure npm authentication for the release workflow, including any required 2FA or trusted-publishing settings. The current workflow uses the `NPM_TOKEN` repository secret and requests provenance.
2. Create or choose a VS Code Marketplace publisher you control and replace `your-publisher-id` in `packages/vscode/package.json`. A VSIX built before this is not a release under your publisher identity. Configure Marketplace credentials separately; the GitHub workflow builds a VSIX but does not publish it to the Marketplace.
3. Review the public files, run a dedicated secrets scan, enable GitHub private vulnerability reporting, and confirm copyright and third-party notices. Review the trusted preview publisher and test fork pull requests in the target repository.
4. Run CI on the public repository, including golden rendering and workflow linting, and smoke-test the packaged CLI and VSIX. Test the extension in an actual VS Code host.
5. Ensure the three package versions match, then run the **Release engine (manual)** workflow with publication disabled. Inspect its output and packages; a dry run does not prove registry authorization or name availability.
6. Once verified, use the workflow's npm and GitHub Release options as appropriate. Publish the VSIX separately with the Marketplace tooling and credentials. Releases are public actions; coordinate their timing and check each result.

The example workflows use `v1` as a placeholder, not a promise that such a tag exists. Pin both workflow references and `engine-ref` to an actual release tag or commit SHA before using them.
