export default {
  start(api) {
    api.registerCapability("reflex-health-assessment", (input) => {
      if (
        !input ||
        typeof input !== "object" ||
        !Number.isFinite(input.health)
      ) {
        throw new TypeError("Health assessment requires a finite health value");
      }
      const health = Math.max(0, Math.min(20, input.health));
      return {
        health,
        urgency: health <= 4 ? "critical" : health <= 8 ? "high" : "normal",
        evidence: "mineflayer-health-observation",
        observedAt:
          typeof input.observedAt === "string" ? input.observedAt : null,
      };
    });
    api.setHealth("ready", "Health assessment capability registered");
  },
  stop() {},
};
