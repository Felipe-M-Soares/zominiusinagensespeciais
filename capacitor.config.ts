import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.concept.usinagens',
  appName: 'Concept Usinagens Especiais',
  webDir: 'dist',
  // SEG-06: força HTTPS no Android — bloqueia HTTP (exceto localhost dev)
  server: {
    androidScheme: 'https',
    allowNavigation: ['*.supabase.co'],
  },
  // iOS: bloqueia conteúdo HTTP não seguro
  ios: {
    limitsNavigationsToAppBoundDomains: true,
  },
};

export default config;
