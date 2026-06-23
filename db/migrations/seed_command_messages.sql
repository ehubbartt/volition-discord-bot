-- Seed: editable command messages (group "messages")
-- Each key is a command slug whose value is an embed template rendered by
-- utils/templateRenderer.js. Admins edit this row from the site's /admin/config editor;
-- the bot hot-reloads it within ~60s and falls back to config/commandMessages.json if
-- the row is missing or malformed.

INSERT INTO bot_config (config_name, config_value, config_group, description)
VALUES (
  'command_messages',
  '{
    "allset": {
      "color": "Green",
      "title": "🎉 You''re All Set!",
      "description": "Welcome to Volition! Here are some areas of interest on this Discord server:\n\n{{channel:VOLITION_POINTS_CHANNEL_ID|#volition-points}} - Gain an understanding of our Volition Points system {{emoji:VP}}\n{{channel:LOOT_CRATE_INFO_CHANNEL_ID|#volition-loot-crate-info}} - Claim your daily loot crate & see how you can win prizes! {{emoji:LC|:package:}}\n{{channel:ASSIGN_ROLES_CHANNEL_ID|#assign-roles}} - Customise your pings according to your interests {{emoji:ALERT_2|:bell:}}\n\nWelcome to Volition and happy scaping! 🥳{{emoji:hasbgrin|😁}}",
      "thumbnail": "{{config:CLAN_ICON_URL}}",
      "footer": "Enjoy your stay with us!",
      "timestamp": true
    }
  }'::jsonb,
  'messages',
  'Editable embed text for bot commands (keyed by command slug). Supports {{channel:KEY}}, {{role:KEY}}, {{emoji:NAME}}, {{config:KEY}}, {{user}} tokens.'
)
ON CONFLICT (config_name) DO NOTHING;
