use axum::{
    extract::{Path, Request},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json},
    routing::post,
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{env, net::SocketAddr, sync::Arc, time::Duration};
use tokio::time::sleep;

#[derive(Clone)]
struct AppState {
    default_transit_delay_ms: u64,
    default_resolver_delay_ms: u64,
}

#[derive(Deserialize, Debug)]
struct GraphQLRequest {
    query: Option<String>,
    variables: Option<Value>,
}

fn parse_delay_header(headers: &HeaderMap, key: &str, default_val: u64) -> u64 {
    if let Some(val) = headers.get(key) {
        if let Ok(str_val) = val.to_str() {
            if let Ok(ms) = str_val.parse::<u64>() {
                return ms;
            }
        }
    }
    default_val
}

// ----------------------------------------------------
// Subgraph Handler: /subgraph/:id
// ----------------------------------------------------
async fn handle_subgraph(
    Path(id): Path<u32>,
    headers: HeaderMap,
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<GraphQLRequest>,
) -> impl IntoResponse {
    let transit = parse_delay_header(&headers, "x-transit-delay-ms", state.default_transit_delay_ms);
    let resolver = parse_delay_header(&headers, "x-resolver-delay-ms", state.default_resolver_delay_ms);
    let total_delay = transit + resolver;

    if total_delay > 0 {
        sleep(Duration::from_millis(total_delay)).await;
    }

    let query = payload.query.unwrap_or_default();
    let variables = payload.variables.unwrap_or_else(|| json!({}));

    let mut data = json!({});

    if let Some(reps) = variables.get("representations").and_then(|r| r.as_array()) {
        let mut entities = Vec::new();
        for rep in reps {
            let entity_id = rep.get("id").and_then(|v| v.as_str()).unwrap_or("1");
            let typename = rep.get("__typename").and_then(|v| v.as_str()).unwrap_or("User");
            let field_key = format!("field_{}", id);
            let field_val = format!("val_{}_{}", id, entity_id);

            entities.push(json!({
                "__typename": typename,
                "id": entity_id,
                field_key: field_val
            }));
        }
        data["_entities"] = json!(entities);
    } else if query.contains("user(") || (id == 1 && query.contains("user")) {
        data["user"] = json!({
            "__typename": "User",
            "id": "1",
            "name": "User 1",
            "field_1": "val_1_1"
        });
    } else if query.contains(&format!("ping_{}", id)) {
        data[format!("ping_{}", id)] = json!(format!("pong_{}", id));
    } else {
        data[format!("subgraph_{}", id)] = json!("ok");
    }

    Json(json!({ "data": data }))
}

// ----------------------------------------------------
// Monograph Handler: /graphql
// ----------------------------------------------------
async fn handle_monograph(
    headers: HeaderMap,
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(payload): Json<GraphQLRequest>,
) -> impl IntoResponse {
    let resolver = parse_delay_header(&headers, "x-resolver-delay-ms", state.default_resolver_delay_ms);

    if resolver > 0 {
        sleep(Duration::from_millis(resolver)).await;
    }

    let query = payload.query.unwrap_or_default();
    let mut data = json!({});

    if query.contains("user") {
        let mut user = serde_json::Map::new();
        user.insert("__typename".to_string(), json!("User"));
        user.insert("id".to_string(), json!("1"));
        user.insert("name".to_string(), json!("User 1"));

        // Match all field_X in the query string
        for token in query.split(|c: char| !c.is_alphanumeric() && c != '_') {
            if token.starts_with("field_") {
                if let Ok(idx) = token.strip_prefix("field_").unwrap().parse::<u32>() {
                    user.insert(token.to_string(), json!(format!("val_{}_1", idx)));
                }
            }
        }
        if !user.contains_key("field_1") {
            user.insert("field_1".to_string(), json!("val_1_1"));
        }
        data["user"] = Value::Object(user);
    } else if query.contains("ping_") {
        let mut pings = serde_json::Map::new();
        for token in query.split(|c: char| !c.is_alphanumeric() && c != '_') {
            if token.starts_with("ping_") {
                if let Ok(idx) = token.strip_prefix("ping_").unwrap().parse::<u32>() {
                    pings.insert(token.to_string(), json!(format!("pong_{}", idx)));
                }
            }
        }
        data = Value::Object(pings);
    } else {
        data["status"] = json!("ok");
    }

    Json(json!({ "data": data }))
}

#[tokio::main]
async fn main() {
    let subgraph_port: u16 = env::var("SUBGRAPH_PORT")
        .unwrap_or_else(|_| "4001".into())
        .parse()
        .expect("Invalid SUBGRAPH_PORT");
    let monograph_port: u16 = env::var("MONOGRAPH_PORT")
        .unwrap_or_else(|_| "4002".into())
        .parse()
        .expect("Invalid MONOGRAPH_PORT");

    let transit_delay: u64 = env::var("TRANSIT_DELAY_MS")
        .unwrap_or_else(|_| "0".into())
        .parse()
        .unwrap_or(0);
    let resolver_delay: u64 = env::var("RESOLVER_DELAY_MS")
        .unwrap_or_else(|_| "0".into())
        .parse()
        .unwrap_or(0);

    let state = Arc::new(AppState {
        default_transit_delay_ms: transit_delay,
        default_resolver_delay_ms: resolver_delay,
    });

    let subgraph_app = Router::new()
        .route("/subgraph/:id", post(handle_subgraph))
        .with_state(state.clone());

    let monograph_app = Router::new()
        .route("/graphql", post(handle_monograph))
        .with_state(state.clone());

    let subgraph_addr = SocketAddr::from(([127, 0, 0, 1], subgraph_port));
    let monograph_addr = SocketAddr::from(([127, 0, 0, 1], monograph_port));

    let subgraph_listener = tokio::net::TcpListener::bind(subgraph_addr).await.unwrap();
    let monograph_listener = tokio::net::TcpListener::bind(monograph_addr).await.unwrap();

    println!("[Rust] Subgraph multiplexer running on http://127.0.0.1:{}/subgraph/:id", subgraph_port);
    println!("[Rust] Monograph server running on http://127.0.0.1:{}/graphql", monograph_port);

    tokio::select! {
        res = axum::serve(subgraph_listener, subgraph_app) => {
            if let Err(e) = res { eprintln!("Subgraph server error: {}", e); }
        }
        res = axum::serve(monograph_listener, monograph_app) => {
            if let Err(e) = res { eprintln!("Monograph server error: {}", e); }
        }
    }
}
