import { Redirect } from 'expo-router'

// Screenshot-capture deep-link landing (pear://pearpetal/screenshot/<N>, used by
// scripts/{android,ios}-screenshots.sh). Like link.tsx/join.tsx, the real handling
// lives in app/index.tsx via Linking.getInitialURL(); this route just redirects to
// the shell so expo-router does not flash +not-found and finish the activity. Inert
// in normal use - only the capture scripts ever open this URL.
export default function ScreenshotRoute () {
  return <Redirect href='/' />
}
