// src/App.tsx
import React, { useState, useEffect, useCallback } from 'react';
import axios, { AxiosError } from 'axios';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Button,
    CircularProgress,
    Alert,
    CssBaseline,
    Container,
    Grid,
    TextField,
    List,
    ListItem,
    ListItemText,
    Divider,
} from '@mui/material';

// --- Constants and Type Definitions ---
const API_URL = 'http://localhost:3001/api';

interface SystemStatus {
    round: string;
    cid: string;
    state: string;
}

interface ActionResponse {
    success: boolean;
    txHash: string;
}

interface ApiError {
    error: string;
}

type AdminAction = 'start' | 'advance' | 'finalize';

// --- Component ---
const App: React.FC = () => {
    // --- State Management ---
    const [status, setStatus] = useState<SystemStatus>({ round: '...', cid: '...', state: '...' });
    const [validModels, setValidModels] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [success, setSuccess] = useState<string>('');
    const [initialCid, setInitialCid] = useState<string>('');
    const [finalCid, setFinalCid] = useState<string>('');

    // --- Data Fetching ---
    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const statusRes = await axios.get<SystemStatus>(`${API_URL}/status`);
            setStatus(statusRes.data);
            if (statusRes.data.state === 'Aggregation') {
                const modelsRes = await axios.get<string[]>(`${API_URL}/valid-models`);
                setValidModels(modelsRes.data);
            } else {
                setValidModels([]);
            }
        } catch (err) {
            let message = "Cannot connect to the backend server.";
            if (axios.isAxiosError<ApiError>(err) && err.response?.data?.error) {
                message = err.response.data.error;
            }
            setError(message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // --- Event Handlers ---
    const handleAction = async (action: AdminAction) => {
        setIsSubmitting(true);
        setError('');
        setSuccess('');
        try {
            let response;
            let successMessage = '';
            switch (action) {
                case 'start':
                    response = await axios.post<ActionResponse>(`${API_URL}/start-round`, { initialModelCID: initialCid });
                    successMessage = `New round started successfully! TxHash: ${response.data.txHash}`;
                    setInitialCid('');
                    break;
                case 'advance':
                    response = await axios.post<ActionResponse>(`${API_URL}/advance-state`);
                    successMessage = `Round state advanced! TxHash: ${response.data.txHash}`;
                    break;
                case 'finalize':
                    response = await axios.post<ActionResponse>(`${API_URL}/finalize-round`, { newGlobalModelCID: finalCid });
                    successMessage = `Round finalized successfully! TxHash: ${response.data.txHash}`;
                    setFinalCid('');
                    break;
                default:
                    throw new Error('Invalid action');
            }
            setSuccess(successMessage);
            setTimeout(fetchData, 4000);
        } catch (err) {
            let message = "An unknown error occurred during the transaction.";
            if (axios.isAxiosError<ApiError>(err) && err.response?.data?.error) {
                message = err.response.data.error;
            }
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    // --- Render Logic ---
    return (
        <>
            <CssBaseline />
            <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
                <Typography variant="h3" component="h1" gutterBottom align="center">
                    Federated Learning Control Panel ⚙️
                </Typography>

                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

                <Grid container spacing={3}>
                    {/* Status Card */}
                    <Grid size={{ xs: 12, md: 6 }}>
                        <Card sx={{ height: '100%' }}>
                            <CardContent>
                                <Typography variant="h5" component="h2" gutterBottom>System Status</Typography>
                                <Typography><strong>Current Round:</strong> {isLoading ? <CircularProgress size={16} /> : status.round}</Typography>
                                <Typography><strong>Round State:</strong> {isLoading ? <CircularProgress size={16} /> : status.state}</Typography>
                                <Typography sx={{ wordBreak: 'break-all' }}><strong>Global Model CID:</strong> {isLoading ? <CircularProgress size={16} /> : status.cid}</Typography>
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* Valid Submissions Card */}
                    <Grid size={{ xs: 12, md: 6 }}>
                        <Card sx={{ height: '100%' }}>
                            <CardContent>
                                <Typography variant="h5" component="h2" gutterBottom>Valid Model Submissions</Typography>
                                {isLoading ? <CircularProgress /> :
                                    validModels.length > 0 ? (
                                        <List dense sx={{ maxHeight: 150, overflow: 'auto' }}>
                                            {validModels.map((cid, index) => (
                                                <ListItem key={index} disableGutters>
                                                    <ListItemText primary={`CID: ${cid}`} sx={{ wordBreak: 'break-all' }} />
                                                </ListItem>
                                            ))}
                                        </List>
                                    ) : (
                                        <Typography variant="body2" color="text.secondary">No valid models or not in Aggregation phase.</Typography>
                                    )
                                }
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* Actions Card */}
                    <Grid size={{ xs: 12 }}>
                        <Card>
                            <CardContent>
                                <Typography variant="h5" gutterBottom>Admin Actions</Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                                    <TextField label="Initial Global Model CID" variant="outlined" size="small" value={initialCid} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInitialCid(e.target.value)} sx={{ flexGrow: 1 }} />
                                    <Button variant="contained" onClick={() => handleAction('start')} disabled={isSubmitting || !initialCid}>Start New Round</Button>
                                </Box>
                                <Divider sx={{ my: 2 }} />
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                                    <TextField label="New Aggregated Global Model CID" variant="outlined" size="small" value={finalCid} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFinalCid(e.target.value)} sx={{ flexGrow: 1 }} />
                                    <Button variant="contained" color="secondary" onClick={() => handleAction('finalize')} disabled={isSubmitting || !finalCid}>Finalize Round</Button>
                                </Box>
                                <Divider sx={{ my: 2 }} />
                                <Box>
                                    <Button variant="outlined" onClick={() => handleAction('advance')} disabled={isSubmitting} fullWidth>Advance Round State</Button>
                                    <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
                                        Moves the contract to the next state (e.g., Submission → Validation).
                                    </Typography>
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>
            </Container>
        </>
    );
}

export default App;