const PLACEHOLDER_PREFIXES = ["your_", "auto_generated_"];

export function hasConfiguredEnvValue(value?: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  const lower = normalized.toLowerCase();
  if (PLACEHOLDER_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return false;
  }

  if (lower === "changeme" || lower === "replace_me") {
    return false;
  }

  return true;
}

export function getConfiguredEnvValue(name: string): string | null {
  const value = process.env[name];
  return hasConfiguredEnvValue(value) ? value!.trim() : null;
}
