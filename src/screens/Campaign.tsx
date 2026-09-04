import { useParams } from 'react-router-dom'

import { Placeholder } from '../components/Placeholder'

export function Campaign() {
  const { campaignId } = useParams()

  return (
    <Placeholder title="Brief" phase="phase 3 builds this screen">
      <p className="text-state-later">Campaign {campaignId}</p>
    </Placeholder>
  )
}
