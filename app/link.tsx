import { Redirect } from 'expo-router'

// Device-link invite deep-link landing (pear://pearpetal/link#... and the https
// equivalent /petal/link). The real handling happens via the Linking listeners
// in app/index.tsx; this route just redirects to the shell so expo-router does
// not show an "Unmatched Route" page for the invite path.
export default function LinkRoute () {
  return <Redirect href='/' />
}
