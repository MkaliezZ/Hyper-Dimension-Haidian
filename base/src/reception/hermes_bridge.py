"""Private, stateless bridge to the locally installed Hermes runtime; no machine tools."""
import contextlib
import json
import logging
import os
import sys

logging.disable(logging.CRITICAL)
sys.path.insert(0, os.environ['HD_HERMES_ROOT'])
request = json.load(sys.stdin)
with contextlib.redirect_stdout(sys.stderr):
    from run_agent import AIAgent
    agent = AIAgent(
        model='deepseek-flash', provider='custom', api_mode='chat_completions',
        base_url='https://api.deepseek.com', api_key=os.environ['DEEPSEEK_API_KEY'],
        enabled_toolsets=[], disabled_toolsets=['all'],
        skip_context_files=True, skip_memory=True, load_soul_identity=False,
        save_trajectories=False, quiet_mode=True, max_iterations=2, max_tokens=1800,
        fallback_model=None, session_db=None,
        request_overrides={'response_format': {'type': 'json_object'}},
    )
    if agent.tools:
        raise RuntimeError('Public reception cannot expose tools')
    # Base owns retention/export/delete. Explicitly disable Hermes' lazy session
    # recall and snapshot writers as well as its optional constructor session_db.
    # This is the installed runtime's persistence-isolation switch; no personal
    # Hermes configuration or database is opened or modified.
    agent._persist_disabled = True
    agent._session_json_enabled = False
    agent._skip_mcp_refresh = True
    result = agent.run_conversation(
        json.dumps({k: request[k] for k in ['question', 'publishedFacts', 'history']}, ensure_ascii=False),
        system_message=request['instructions'],
    )
    if result.get('failed') or not result.get('final_response'):
        raise RuntimeError('Hermes conversation did not complete')
    answer = result['final_response'].strip()
    if answer.startswith('```'):
        answer = answer.split('\n', 1)[1].rsplit('```', 1)[0].strip()
    answer = json.loads(answer)
    answer.update(model=agent.model, transport='local-hermes', toolCount=len(agent.tools))
print(json.dumps(answer, ensure_ascii=False))
