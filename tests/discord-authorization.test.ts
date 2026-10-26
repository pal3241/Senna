import type { ChatInputCommandInteraction } from "discord.js";
import { describe, expect, it } from "vitest";
import { configSchema } from "../src/core/config.js";
import { isAuthorized } from "../src/adapters/discord/interaction-authorization.js";

const config = configSchema.parse({
  DISCORD_OWNER_IDS: "owner-1",
  DISCORD_ADMIN_ROLE_IDS: "admin-role",
  DISCORD_GUILD_ID: "guild-1",
  DISCORD_COMMAND_CHANNEL_IDS: "channel-1",
});

function interaction(userId: string, roles: string[], guildId = "guild-1") {
  return {
    inGuild: () => true,
    guildId,
    channelId: "channel-1",
    user: { id: userId },
    member: { roles },
  } as unknown as ChatInputCommandInteraction;
}

describe("Discord authorization", () => {
  it("allows configured owners and admin roles within the configured guild", () => {
    expect(isAuthorized(interaction("owner-1", []), config)).toBe(true);
    expect(isAuthorized(interaction("user-2", ["admin-role"]), config)).toBe(
      true,
    );
  });

  it("denies unlisted users, unlisted roles, and other guilds", () => {
    expect(isAuthorized(interaction("user-2", []), config)).toBe(false);
    expect(
      isAuthorized(interaction("user-2", ["admin-role"], "guild-2"), config),
    ).toBe(false);
    const otherChannel = {
      ...interaction("owner-1", []),
      channelId: "channel-2",
    } as unknown as ChatInputCommandInteraction;
    expect(isAuthorized(otherChannel, config)).toBe(false);
  });

  it("denies commands outside guilds even for an owner", () => {
    const dm = {
      ...interaction("owner-1", []),
      inGuild: () => false,
      guildId: null,
    } as unknown as ChatInputCommandInteraction;
    expect(isAuthorized(dm, config)).toBe(false);
  });
});
