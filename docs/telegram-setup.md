# Telegram Setup

## 1. Create a Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`
3. Follow prompts to name your bot
4. Copy the bot token

## 2. Configure

Set the token in `.env`:

```
TELEGRAM_BOT_TOKEN=your-token-here
```

Enable Telegram adapter in `config/adapters.yaml`:

```yaml
adapters:
  telegram:
    enabled: true
    token_env: TELEGRAM_BOT_TOKEN
    polling:
      enabled: true
```

## 3. Register Your User

Add your Telegram user ID to `config/users.yaml`:

```yaml
users:
  - id: "telegram:YOUR_USER_ID"
    name: "Your Name"
    role: "owner"
    allowed_projects:
      - "your-project"
    allowed_modes:
      - "read_only"
      - "suggest"
      - "edit_guarded"
      - "execute_guarded"
```

To find your Telegram user ID, message [@userinfobot](https://t.me/userinfobot).

## 4. Start

```bash
npm run dev
```

Send `/pf help` to your bot to verify.
