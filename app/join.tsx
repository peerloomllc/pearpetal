import { Redirect } from 'expo-router'

// Partner-share invite deep-link landing (pear://pearpetal/join#... and the https
// equivalent /petal/join). The real handling happens via the Linking listeners
// in app/index.tsx; this route just redirects to the shell so expo-router does
// not show an "Unmatched Route" page for the invite path.
export default function JoinRoute () {
  return <Redirect href='/' />
}
