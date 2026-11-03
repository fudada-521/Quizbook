import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gaoxiang.quiz',
  appName: '题本',
  webDir: '../web/dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
