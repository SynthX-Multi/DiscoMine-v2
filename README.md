# DiscoMine v2 🎮

**DiscoMine** is a **24/7 Discord-controlled AFK bot** for Minecraft servers, powered by **Mineflayer** and designed for **Quaxly** hosting.

It keeps your Minecraft server awake by automatically connecting an AFK bot whenever no real players are online. When someone joins, the bot disconnects so they have the server to themselves. DiscoMine also monitors player activity, manages idle shutdowns with LazyMC-style logic, and provides live server controls directly from its Discord control panel.

---

# ✨ Features

| Feature                        | Description                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| **Discord control panel**      | Start, stop, and monitor your Minecraft server directly from Discord.                   |
| **Live server status**         | View server status, player count, uptime, and idle timer from the control panel.        |
| **Automatic player detection** | Disconnects when a real player joins and reconnects when everyone leaves.               |
| **LazyMC-style idle logic**    | Bot will automatically leave when someone joins and join when everyone leaves           |
| **Anti-AFK behavior**          | Random movements, looking around, sneaking, and arm swings help prevent AFK kicks.      |
| **Automatic reconnects**       | Uses exponential backoff and continuously retries until successful or manually stopped. |
| **Discord presence**           | Displays the current player count in the bot's status.                                  |
| **Status channel**             | Automatically posts server events and status updates to Discord.                        |

---

# 🚀 Setup

> [!TIP]
> To deploy and configure DiscoMine, follow the instructions in **[Setup.md](Setup.md)**.

---

# 🧠 How It Works

```text
No Players Online
        │
        ▼
AFK Bot Connects
        │
        ▼
Server Stays Awake
        │
        │
Player Joins
        ▼
AFK Bot Disconnects
        │
        ▼
Player Uses Server Normally
        │
        │
Everyone Leaves
        ▼
AFK Bot Reconnects
```

DiscoMine automatically manages your server:

- When the server is empty, the AFK bot connects to keep it awake.
- As soon as a real player joins, the bot disconnects.
- After everyone leaves, the bot reconnects automatically.
- You can manually start, stop, and monitor the bot at any time using the Discord control panel.

---

# ⚙️ Configuration

All configuration is handled through environment variables—no code changes required.

| Variable            | Default        | Description                                           |
| ------------------- | -------------- | ----------------------------------------------------- |
| `DISCORD_TOKEN`     | **Required**   | Discord bot token                                     |
| `CLIENT_ID`         | **Required**   | Discord application client ID                         |
| `GUILD_ID`          | **Required**   | Discord server ID                                     |
| `MC_SERVER_IP`      | **Required**   | Minecraft server address                              |
| `MC_SERVER_PORT`    | `25565`        | Minecraft server port                                 |
| `MC_SERVER_VERSION` | `Auto`         | Minecraft server version.                             |
| `MC_USERNAME`       | `DiscoMineAFK` | AFK bot username                                      |
| `MC_PASSWORD`       | *(empty)*      | Leave empty for offline/cracked servers               |
| `MC_AUTH`           | `offline`      | `offline` or `microsoft`                              |
| `STATUS_CHANNEL_ID` | **Required**   | Channel used for the control panel and status updates |

---

# 📁 Project Structure

```text
DiscoMine/
├── index.js          # Discord bot
├── minecraft.js      # AFK bot & server monitoring
├── config.js         # Environment configuration
├── package.json      # Project dependencies
├── .env.example      # Environment template
├── LICENSE           # GNU GPL v3
├── Setup.md          # Deployment guide
└── README.md         # Project documentation
```

---

# 🏠 Running Locally

```bash
npm install

cp .env.example .env

# Edit .env with your configuration

npm start
```

---

# 📄 License

Licensed under the **GNU General Public License v3.0**.

See the **[LICENSE](LICENSE)** file for full license details.

---

**DiscoMine v2** • A Discord-powered AFK bot that keeps Minecraft servers online, automatically manages player activity, and provides simple server control through an interactive Discord panel.
