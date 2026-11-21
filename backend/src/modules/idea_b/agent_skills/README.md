# Idea B agent playbooks

The backend picks the applicable playbook by endpoint and passes its Markdown instructions to GPT-6 Luna. The buyer brief and local evidence playbooks use the existing catalog and computed signals. Catalog, ranking and trend calculations still live in Python. Playbooks also work with the other models supported by the configured Responses integration.

To include live market context, request `GET /api/ideas/idea-b/trends?fruit=mango&lang=th&explain=true&web_search=true`. Live context is returned as `market_context`, including its status, retrieval timestamp, summary and URL citations when available. The trend score and signals retain their original demo provenance.

The backend starts the local MCP stdio server using `python -m backend.src.modules.idea_b.market_search`. It exposes the read-only `search_fruit_market` tool, which calls OpenAI Responses Web Search using the backend's `OPENAI_API_KEY` and `OPENAI_MODEL` environment. Search is opt-in and the API returns the demo trend if the MCP process or search is unavailable.
