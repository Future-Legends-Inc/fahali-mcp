# Fahali + CrewAI Example

A 2-agent market analyst crew that calls Fahali for verdict + risk.

## Prerequisites

- Python 3.10+
- A Fahali API key (free: https://fahaliai.com/developer)

## Setup

```bash
pip install crewai crewai-tools
```

## Usage

```python
from crewai import Agent, Task, Crew
from crewai_tools import MCPTool

# Load Fahali tools via MCP
fahali_tools = MCPTool.from_mcp(
    url="https://mcp.fahaliai.com/sse?api_key=YOUR_API_KEY",
    client_config={"name": "fahali-crewai", "version": "1.0.0"},
)

# Create agents
market_analyst = Agent(
    role="Market Analyst",
    goal="Answer market and risk questions using Fahali",
    backstory="You analyze markets using Fahali's detection fleet and its judged track record.",
    tools=fahali_tools,
    verbose=True,
)

# Create tasks
task = Task(
    description="Get the current market verdict and risk score for BTCUSDT and NVDA",
    agent=market_analyst,
)

crew = Crew(agents=[market_analyst], tasks=[task])
result = crew.kickoff()
print(result)
```

## Observation, not advice

Fahali provides market intelligence only. No financial advice.
