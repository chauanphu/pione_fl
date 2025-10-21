import os
import logging
import requests
from fastapi import FastAPI, BackgroundTasks, HTTPException, status
from pydantic import BaseModel, HttpUrl
from typing import List

# Import the machine learning logic from our dedicated module
from aggregator import create_dummy_model, aggregate_models

# --- Configuration & Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = FastAPI(
    title="Federated Learning Aggregation Service",
    description="An API to aggregate TensorFlow models for a federated learning system.",
    version="1.0.0"
)

# Directory to save the final aggregated models
OUTPUT_DIR = "aggregated_models"
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)
    logging.info(f"Created output directory: {OUTPUT_DIR}")


# --- Pydantic Models for Request Validation ---

class AggregationRequest(BaseModel):
    roundId: str
    models_directory: str
    callback_url: HttpUrl

class TestModelRequest(BaseModel):
    num_models: int = 3
    test_dir: str = "test_models/round_test"


# --- Background Task for Aggregation ---

def run_aggregation_and_callback(round_id: str, models_dir: str, callback_url: str):
    """
    This function runs in the background to perform the heavy lifting of model aggregation.
    """
    logging.info(f"[{round_id}] Starting aggregation process for models in: {models_dir}")

    try:
        # Find all model files in the specified directory
        model_paths = [os.path.join(models_dir, f) for f in os.listdir(models_dir) if f.endswith('.h5')]

        if not model_paths:
            raise ValueError("No model files (.h5) found in the specified directory.")

        logging.info(f"[{round_id}] Found {len(model_paths)} models to aggregate.")

        # Perform the aggregation using our helper function
        aggregated_model = aggregate_models(model_paths)
        if aggregated_model is None:
             raise Exception("Model aggregation failed. Check logs for details.")

        # Save the new global model to the output directory
        output_filename = f"global_model_{round_id}.h5"
        aggregated_model_path = os.path.join(OUTPUT_DIR, output_filename)
        aggregated_model.save(aggregated_model_path)
        logging.info(f"[{round_id}] Aggregated model saved to: {aggregated_model_path}")

        # Prepare callback data
        callback_data = {
            "roundId": round_id,
            "status": "success",
            "aggregated_model_path": os.path.abspath(aggregated_model_path)
        }
        response_status = "success"

    except Exception as e:
        logging.error(f"[{round_id}] An error occurred during aggregation: {e}", exc_info=True)
        callback_data = {
            "roundId": round_id,
            "status": "error",
            "message": str(e)
        }
        response_status = "error"

    # --- Send Callback to TypeScript Service ---
    try:
        logging.info(f"[{round_id}] Sending {response_status} callback to: {callback_url}")
        requests.post(callback_url, json=callback_data, timeout=15)
        logging.info(f"[{round_id}] Callback sent successfully.")
    except requests.exceptions.RequestException as e:
        logging.error(f"[{round_id}] Failed to send callback to {callback_url}: {e}")


# --- API Endpoints ---

@app.post("/aggregate", status_code=status.HTTP_202_ACCEPTED)
def aggregate_endpoint(request: AggregationRequest, background_tasks: BackgroundTasks):
    """
    Triggers the model aggregation process asynchronously.

    It immediately returns a 202 Accepted response and starts the aggregation
    in a background task.
    """
    if not os.path.isdir(request.models_directory):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Directory not found: {request.models_directory}"
        )

    # Add the heavy computation to the background tasks
    background_tasks.add_task(
        run_aggregation_and_callback,
        request.roundId,
        request.models_directory,
        str(request.callback_url)
    )

    logging.info(f"Accepted aggregation request for round '{request.roundId}'. Process started in background.")
    return {"status": "Aggregation process started", "roundId": request.roundId}


@app.post("/create_test_models", status_code=status.HTTP_201_CREATED)
def create_test_models_endpoint(request: TestModelRequest):
    """
    A utility endpoint to create dummy local models for testing.
    """
    if not os.path.exists(request.test_dir):
        os.makedirs(request.test_dir)

    for i in range(request.num_models):
        model = create_dummy_model()
        model_path = os.path.join(request.test_dir, f'local_model_{i+1}.h5')
        model.save(model_path)

    abs_path = os.path.abspath(request.test_dir)
    return {
        "message": f"Successfully created {request.num_models} dummy models.",
        "directory": abs_path
    }

if __name__ == '__main__':
    import uvicorn
    # For production, you would run this with: uvicorn main:app --host 0.0.0.0 --port 5000
    uvicorn.run(app, host='0.0.0.0', port=5000, reload=True)
