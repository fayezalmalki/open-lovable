import { SandboxProvider, SandboxProviderConfig } from './types';
import { E2BProvider } from './providers/e2b-provider';
import { VercelProvider } from './providers/vercel-provider';
import { getConfiguredEnvValue } from '@/lib/env';

type SandboxProviderName = 'e2b' | 'vercel';

export class SandboxFactory {
  static create(provider?: string, config?: SandboxProviderConfig): SandboxProvider {
    const selectedProvider = this.resolveProvider(provider);

    switch (selectedProvider) {
      case 'e2b':
        return new E2BProvider(config || {});
      
      case 'vercel':
        return new VercelProvider(config || {});
    }
  }
  
  static getAvailableProviders(): string[] {
    return ['e2b', 'vercel'];
  }
  
  static isProviderAvailable(provider: string): boolean {
    switch (this.normalizeProvider(provider)) {
      case 'e2b':
        return !!getConfiguredEnvValue('E2B_API_KEY');
      
      case 'vercel':
        return !!getConfiguredEnvValue('VERCEL_OIDC_TOKEN') ||
          (!!getConfiguredEnvValue('VERCEL_TOKEN') &&
            !!getConfiguredEnvValue('VERCEL_TEAM_ID') &&
            !!getConfiguredEnvValue('VERCEL_PROJECT_ID'));
    }
  }

  static resolveProvider(provider?: string): SandboxProviderName {
    const requestedProvider = this.normalizeProvider(
      provider || process.env.SANDBOX_PROVIDER || 'e2b'
    );

    if (this.isProviderAvailable(requestedProvider)) {
      return requestedProvider;
    }

    const fallbackProvider = this.getAvailableProviders()
      .map((name) => this.normalizeProvider(name))
      .find((name) => name !== requestedProvider && this.isProviderAvailable(name));

    if (fallbackProvider) {
      console.warn(
        `[SandboxFactory] Requested provider "${requestedProvider}" is unavailable. Falling back to "${fallbackProvider}".`
      );
      return fallbackProvider;
    }

    throw new Error(this.getUnavailableProviderMessage(requestedProvider));
  }

  private static normalizeProvider(provider: string): SandboxProviderName {
    const normalized = provider.toLowerCase();
    if (normalized === 'e2b' || normalized === 'vercel') {
      return normalized;
    }

    throw new Error(`Unknown sandbox provider: ${provider}. Supported providers: e2b, vercel`);
  }

  private static getUnavailableProviderMessage(provider: SandboxProviderName): string {
    if (provider === 'vercel') {
      return 'Selected sandbox provider "vercel" is not configured. Set VERCEL_OIDC_TOKEN or VERCEL_TOKEN with VERCEL_TEAM_ID and VERCEL_PROJECT_ID, or switch SANDBOX_PROVIDER to "e2b" and configure E2B_API_KEY.';
    }

    return 'Selected sandbox provider "e2b" is not configured. Set E2B_API_KEY, or switch SANDBOX_PROVIDER to "vercel" and configure VERCEL_OIDC_TOKEN or VERCEL_TOKEN with VERCEL_TEAM_ID and VERCEL_PROJECT_ID.';
  }
}
