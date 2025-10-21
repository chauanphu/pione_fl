import os
import numpy as np
import tensorflow as tf
import logging
import keras

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Model Creation (for Testing) ---

def create_dummy_model():
    """
    Creates and compiles a simple sequential Keras model for testing purposes.
    The model has a simple architecture: Input(10) -> Dense(10) -> Output(1).
    Weights are initialized randomly.

    Returns:
        keras.Model: A compiled Keras model.
    """
    model = keras.models.Sequential([
        keras.layers.Input(shape=(10,)),
        keras.layers.Dense(10, activation='relu'),
        keras.layers.Dense(1, activation='sigmoid')
    ])
    model.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])
    logging.info("Created a dummy Keras model instance.")
    return model

# --- Core Aggregation Logic ---

def aggregate_models(model_paths: list[str]) -> keras.Model | None:
    """
    Performs federated averaging on a list of Keras models.

    Args:
        model_paths (list[str]): A list of file paths to the .h5 model files.

    Returns:
        keras.Model: A new Keras model with the averaged weights.
        None: If aggregation fails or no models are provided.
    """
    if not model_paths:
        logging.warning("aggregate_models called with no model paths.")
        return None

    try:
        # 1. Load all models and collect their weights
        all_models_weights = []
        for path in model_paths:
            if os.path.exists(path):
                model = keras.models.load_model(path)
                all_models_weights.append(model.get_weights())
                logging.info(f"Loaded weights from model: {path}")
            else:
                logging.warning(f"Model path not found, skipping: {path}")

        if not all_models_weights:
            logging.error("Could not load any models from the provided paths.")
            return None

        # 2. Calculate the average of the weights
        avg_weights = []
        # Iterate through each layer's weights
        for weights_list_tuple in zip(*all_models_weights):
            # Average the weights for the current layer across all models
            layer_mean = np.mean(np.array(weights_list_tuple), axis=0)
            avg_weights.append(layer_mean)

        logging.info(f"Successfully averaged weights from {len(all_models_weights)} models.")

        # 3. Create a new model and set the averaged weights
        # We use the first model in the list as a template for the architecture
        aggregated_model = keras.models.load_model(model_paths[0])
        if aggregate_models is None:
            raise ("Can't load model")
        aggregated_model.set_weights(avg_weights)
        logging.info("Created new global model and set averaged weights.")

        return aggregated_model

    except Exception as e:
        logging.error(f"An error occurred during model aggregation: {e}", exc_info=True)
        return None
