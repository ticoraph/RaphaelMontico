# Traçabilité avec Langfuse (SDK V4)

Ce projet utilise [Langfuse](https://langfuse.com) pour la traçabilité (observabilité) complète des appels au LLM et du pipeline RAG. L'application backend utilise désormais la **Version 4** du SDK Python de Langfuse.

## Variables d'Environnement

Pour activer la capture des traces sur le backend (notamment en production), les variables d'environnement suivantes doivent être définies dans votre `.env` et configurées sur votre hébergeur (ex: AWS App Runner, API Gateway) :

```bash
LANGFUSE_SECRET_KEY="sk-lf-..."
LANGFUSE_PUBLIC_KEY="pk-lf-..."
LANGFUSE_BASE_URL="https://cloud.langfuse.com" # Ou l'URL de votre instance (EU ou self-hosted)
```

> **Important :** Utilisez bien la variable `LANGFUSE_BASE_URL` tel que spécifié dans la documentation de Langfuse, et non pas l'ancienne version `LANGFUSE_HOST`.

## Comment ça marche

Le backend Python intercepte automatiquement les requêtes via des décorateurs et gère le cycle de vie du contexte de manière asynchrone avec OpenTelemetry :

### Initialisation et Flush (Lifespan)
Le SDK de Langfuse initialise une file d'attente pour expédier les évènements de façon asynchrone sans bloquer l'application. Dans `app/main.py`, le `lifespan` FastAPI vérifie l'authentification et effectue un flush global lors de l'arrêt du serveur :

```python
from langfuse import get_client

@asynccontextmanager
async def lifespan(app: FastAPI):
    get_client().auth_check() # Vérification de l'authentification Langfuse
    yield
    # ...
    get_client().flush()      # Envoi des dernières traces avant l'extinction
```

### Instrumentation
- `@observe(name="chat_api")` sur la route `/api/chat` : Crée une Trace globale pour chaque message utilisateur.
- Le client Langfuse global est récupérable via `get_client()` pour rajouter des métadonnées contextuelles dans la route (par exemple : `get_client().update_current_span(...)`).

### Problème de contexte avec les réponses en streaming
Lorsqu'on utilise des réponses en streaming (`StreamingResponse` de FastAPI), la fonction génératrice (le stream) est exécutée dans un contexte asynchrone distinct qui peut casser l'arborescence des traces.

Avec Langfuse V4 (reposant sur **OpenTelemetry**), ce problème est résolu en capturant explicitement le contexte de trace avant de créer le flux et en le rattachant à l'intérieur du flux :

```python
import opentelemetry.context as otel_context

@router.post("/chat")
@observe(name="chat_api")
async def chat(...):
    # 1. On capture le contexte en cours (qui contient la trace Langfuse active)
    current_context = otel_context.get_current()

    async def event_stream():
        # 2. On attache ce contexte dans le générateur
        token = otel_context.attach(current_context)
        try:
            # 3. Les appels au LLM lancés ici seront correctement liés au parent
            async for item in llm.stream(...):
                yield item
        finally:
            # 4. On détache proprement le contexte
            otel_context.detach(token)

    return StreamingResponse(
        event_stream(),
        # 5. Flush de Langfuse après chaque réponse asynchrone
        background=BackgroundTask(get_client().flush)
    )
```

## Visualisation (Dashboard)

En vous connectant à votre projet sur Langfuse Cloud, vous pourrez consulter :
1. **Les Traces** : Le flux complet depuis la réception du message jusqu'à la fin de la réponse streamée.
2. **Le Coût & les Latences** : Si vous configurez les coûts, Langfuse permet le suivi du pricing et la mesure du temps de la génération et de la recherche (Retrieval).
