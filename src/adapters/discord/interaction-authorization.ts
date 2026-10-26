import type { ChatInputCommandInteraction } from "discord.js";
import type { AppConfig } from "../../core/config.js";

export function isAuthorized(
  interaction: ChatInputCommandInteraction,
  config: AppConfig,
): boolean {
  if (!interaction.inGuild() || !interaction.guildId) return false;
  if (
    config.DISCORD_GUILD_ID &&
    interaction.guildId !== config.DISCORD_GUILD_ID
  )
    return false;
  if (
    config.DISCORD_COMMAND_CHANNEL_IDS.length > 0 &&
    (!interaction.channelId ||
      !config.DISCORD_COMMAND_CHANNEL_IDS.includes(interaction.channelId))
  ) {
    return false;
  }
  if (config.DISCORD_OWNER_IDS.includes(interaction.user.id)) return true;
  const roles = roleIds(interaction);
  return config.DISCORD_ADMIN_ROLE_IDS.some((roleId) => roles.has(roleId));
}

function roleIds(interaction: ChatInputCommandInteraction): Set<string> {
  const member = interaction.member;
  if (!member || !("roles" in member)) return new Set();
  const roles = member.roles;
  if (Array.isArray(roles)) return new Set(roles);
  if (roles && typeof roles === "object" && "cache" in roles) {
    return new Set([...roles.cache.keys()]);
  }
  return new Set();
}
