import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Custom web document shell for Expo Router.
 * Locks the page to a dark stage so the PhoneShell can frame the app like a device.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"
        />
        <title>EVSaathi</title>
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body, #root {
                height: 100%;
                margin: 0;
                padding: 0;
                background: #04060C;
                overflow: hidden;
              }
              body {
                font-family: Manrope, "DM Sans", system-ui, sans-serif;
                -webkit-font-smoothing: antialiased;
              }
              /* Kill Expo web stretch — app content lives inside PhoneShell */
              #root > div {
                height: 100%;
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
