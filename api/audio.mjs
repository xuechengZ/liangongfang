import { handleCloudRequest } from '../cloud/vercel-adapter.mjs'

export default {
  async fetch(request, context) {
    return handleCloudRequest(request, '/audio', context)
  },
}
