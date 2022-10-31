import { Toolkit } from 'actions-toolkit'
import { syncAllIssues } from './action'

Toolkit.run(syncAllIssues, {
  secrets: ['GITHUB_TOKEN']
})
