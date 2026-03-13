# VS Code Agent Files (.agent.md)

These `.agent.md` files enable **VS Code Copilot to route work to specialized agents** through auto-selection or manual invocation.

## 📁 Agent Files

| File                                           | Triggers When Working On                              | Purpose                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [app-agent.agent.md](app-agent.agent.md)       | `server/**`, `container/**`, `lambda/**`, `client/**` | Loads nodejs-backend, ffmpeg-video-pipeline skills; enforces AWS SDK v3, Socket.IO, SIGTERM rules  |
| [infra-agent.agent.md](infra-agent.agent.md)   | `IaC/**`, `ansible/**`, `Makefile`, `deploy*.sh`      | Loads pulumi-best-practices, ansible-playbooks, makefile-automation; enforces deployment order     |
| [review-agent.agent.md](review-agent.agent.md) | `**/*.ts`, `**/*.tsx`, `**/*.yml`                     | Read-only review mode; loads code-reviewer, aws-solution-architect, aws-diagrams                   |
| [docs-agent.agent.md](docs-agent.agent.md)     | Manual only: `@docs-agent` or `/docs-agent`           | Generates architecture docs, enforces Excalidraw flow output, and supports AWS icon cloud diagrams |

## 🚀 How It Works

### Auto-Selection (Recommended)

VS Code Copilot automatically picks the right agent when you:

- Open a file in `server/` → App Agent activates
- Edit `IaC/index.ts` → Infra Agent activates
- Review `server/app.ts` → Review Agent can be manually selected

### Manual Selection

In Copilot Chat, type:

```
@app-agent help me add video upload validation
@infra-agent what's the deployment order?
@review-agent review this PR
@docs-agent create architecture and data-flow documentation for VisionSync
```

Or use the custom commands in [../.vscode/settings.json](../.vscode/settings.json):

```
/app-agent help me add a route
/infra-agent deploy the app
/review-agent check for security issues
```

Or use workflow files in `.agents/workflows/`:

```
/docs-agent generate architecture documentation with Excalidraw data flow
```

## 📋 YAML Frontmatter Explained

Each `.agent.md` file starts with metadata:

```yaml
---
name: app-agent
description: VisionSync Application Development Agent
applyTo:
  - "server/**" # Auto-activate when editing files matching these patterns
  - "container/**"
preferredTools:
  - read_file # Tools this agent should use
  - replace_string_in_file
avoidTools:
  - run_in_terminal # Tools this agent should avoid
ignorePatterns:
  - "IaC/**" # Files this agent shouldn't touch
---
```

## 🔧 Editing Agents

To modify agent behavior:

1. Edit the `.agent.md` file
2. Change `applyTo` patterns to adjust auto-activation
3. Add/remove skills in the "Skills You Must Load" section
4. Update rules in the "Mandatory Rules" section
5. Reload VS Code window (Ctrl+Shift+P → "Developer: Reload Window")

## 🔄 Relationship to Other Configs

These `.agent.md` files **complement** the existing setup:

| Config                            | Purpose                                 | When to Use                                               |
| --------------------------------- | --------------------------------------- | --------------------------------------------------------- |
| `.agents/workflows/*.md`          | Antigravity AI slash commands           | When using Antigravity extension                          |
| `.github/copilot-instructions.md` | Global Copilot project context          | Auto-loaded by Copilot                                    |
| `.vscode/settings.json`           | Custom Copilot chat commands            | Type `/app-agent`, `/infra-agent`, etc.                   |
| `.agents/*.agent.md`              | **Specialized agents (auto or manual)** | **Auto-activates by file match or manual `@agent` usage** |

All of them reference the shared [CONTEXT.md](CONTEXT.md) for consistency.

## 📚 References

- [VS Code Agent Customization Docs](https://code.visualstudio.com/docs/copilot/copilot-customization)
- [GitHub Copilot Chat Commands](https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-chat)
- [VisionSync Context](CONTEXT.md)
- [Skills Directory](./skills/)

## 💡 Tips

**Want an agent to auto-activate on specific files?**

```yaml
applyTo:
  - "server/routes/*.ts" # Only route files
  - "IaC/src/storage/**" # Only storage infrastructure
```

**Want an agent to avoid certain tools?**

```yaml
avoidTools:
  - run_in_terminal # Review Agent shouldn't execute commands
  - create_file # Review Agent shouldn't create files
```

**Want an agent to ignore certain files?**

```yaml
ignorePatterns:
  - "node_modules/**"
  - "build/**"
  - "*.test.ts" # Don't auto-activate on test files
```

---

**Ready to use!** Open any file in `server/` and Copilot will automatically load the App Agent context.
