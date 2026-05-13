# Contributing to PetFish Remote

Thank you for your interest in contributing. This guide outlines the setup, workflow, and architecture to help you get started quickly.

## Getting Started

1. Ensure you have Node.js 20 or higher installed.
2. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
3. Verify your setup by running the typechecker and tests:
   ```bash
   npm run typecheck && npm test
   ```

## Development Workflow

Use the following npm scripts during development:

* `npm run dev`: Start the application in watch mode.
* `npm run build`: Compile TypeScript and copy static assets/plugins.
* `npm run test`: Run the test suite using vitest.
* `npm run test:watch`: Run tests in watch mode.
* `npm run lint`: Check for code style issues.

## Project Structure

The `src/` directory is organized by domain:

* `adapters/`: Platform integrations (Telegram, Slack, Feishu, WeCom, Web).
* `core/`: Core business logic and task management.
* `connector/`: Connection handling.
* `protocol/`: Shared types and interface definitions.
* `server/`: Server infrastructure and API routes.
* `runtime/`: Execution environment logic.
* `render/`: Output formatting and batching.
* `plugin/`: Plugin system.
* `storage/`: Database operations using better-sqlite3.

**License Notice**: This project uses a split license. Code in `connector/` and `protocol/` is under the Apache-2.0 license. Code in `server/`, `adapters/`, and `core/` is Proprietary.

## Code Style

* Use TypeScript in strict mode.
* Use ESM syntax with `.js` extensions for local imports.
* Validate external input and runtime data using Zod.
* Run `npm run lint` and `npm run typecheck` before committing.

## Adding a New Adapter

To add support for a new messaging platform:

1. Implement the `IMAdapter` interface in a new directory under `src/adapters/`.
2. Create a platform-specific render policy to handle constraints like character limits.
3. Wire the new adapter into the application entry point (`main.ts`).
4. Look at existing adapters like Telegram or Feishu for reference implementations.

## Testing

The project currently has 95 tests across 8 files in the `tests/` directory. We use vitest as our test runner. All pull requests must pass the test suite and typechecking (`npm run typecheck && npm test`) before merging. Write tests for any new functionality or bug fixes.

## Pull Request Guidelines

1. Fork the repository and create a feature branch.
2. Keep your commits focused and provide clear descriptions.
3. Submit a pull request against the main branch.
4. Note that any contributions modifying `server/`, `adapters/`, or `core/` are submitted under the project's Proprietary license terms.

## Reporting Issues

Report bugs or feature requests using the repository issue tracker. Include clear reproduction steps, expected behavior, and actual behavior when reporting bugs.

## Key Gotchas

Please review `AGENTS.md` for full development rules. Keep these critical constraints in mind:

* **Task State Machine**: `TaskManager.updateStatus()` enforces transitions via a `VALID_TRANSITIONS` table. Never update the status field directly in storage.
* **PolicyEngine**: The policy engine evaluates all tasks before dispatch. Configurations block specific targets and require approval for certain actions (like write or exec).
* **OutputBatcher**: You must explicitly pass a `renderPolicy` when creating an `OutputBatcher`. Platforms have different limits (e.g. Telegram is 4096 chars, Feishu is 30000 chars).
* **grammY Initialization**: `bot.start()` is fire-and-forget. Run it in the background and use callbacks to track state rather than awaiting it.
* **Cross-repo Prohibition**: Never directly modify or push to other repositories. Use pull requests or issues for cross-repository collaboration.
