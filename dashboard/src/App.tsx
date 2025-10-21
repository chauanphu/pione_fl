// src/App.tsx
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
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
    Paper,
    // --- MODIFIED IMPORTS: Added Table components ---
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
} from '@mui/material';
import { UploadFile } from '@mui/icons-material';

// --- Constants and Type Definitions ---
const API_URL = 'http://localhost:3001/api';

interface SystemStatus {
    round: string;
    cid: string;
    state: string;
}

interface HistoryItem {
    round: string;
    cid: string;
}

interface ActionResponse {
    success: boolean;
    txHash?: string;
    initialModelCID?: string;
}

interface ApiError {
    error: string;
}

// --- Component ---
const App: React.FC = () => {
    // --- State Management ---
    const [status, setStatus] = useState<SystemStatus>({ round: '...', cid: '', state: '...' });
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [isUploading, setIsUploading] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [success, setSuccess] = useState<string>('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    // --- REMOVED: `initialCid` state is no longer needed ---

    // --- Data Fetching ---
    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const statusRes = await axios.get<SystemStatus>(`${API_URL}/status`);
            setStatus(statusRes.data);

            const historyRes = await axios.get<HistoryItem[]>(`${API_URL}/global-models-history`);
            setHistory(historyRes.data);

        } catch (err) {
            const message = (axios.isAxiosError<ApiError>(err) && err.response?.data?.error)
                ? err.response.data.error
                : "Cannot connect to the backend server.";
            setError(message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000); // Poll every 10 seconds
        return () => clearInterval(interval);
    }, [fetchData]);

    // --- Event Handlers ---
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setError('');
            setSuccess('');
        }
    };

    // --- MODIFIED: This function now sets the initial model on the contract ---
    const handleSetInitialModel = async () => {
        if (!selectedFile) {
            setError("Please select a model file first.");
            return;
        }
        setIsUploading(true);
        setError('');
        setSuccess('');

        const formData = new FormData();
        formData.append('modelFile', selectedFile);

        try {
            // --- MODIFIED: Endpoint changed to `/set-initial-model` ---
            const response = await axios.post<ActionResponse>(`${API_URL}/set-initial-model`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (response.data.success && response.data.initialModelCID) {
                setSuccess(`Initial model set successfully! CID: ${response.data.initialModelCID}`);
                setSelectedFile(null); // Clear the file input
                setTimeout(fetchData, 4000); // Refresh data to show new CID and status
            }
        } catch (err) {
            const message = (axios.isAxiosError<ApiError>(err) && err.response?.data?.error)
                ? err.response.data.error
                : "An unknown error occurred during upload.";
            setError(message);
        } finally {
            setIsUploading(false);
        }
    };

    // --- MODIFIED: This function no longer sends a CID ---
    const handleStartRound = async () => {
        setIsSubmitting(true);
        setError('');
        setSuccess('');
        try {
            // --- MODIFIED: Endpoint changed to `/start-round` and body removed ---
            const response = await axios.post<ActionResponse>(`${API_URL}/start-round`);
            setSuccess(`New round started successfully! TxHash: ${response.data.txHash}`);
            setTimeout(fetchData, 4000); // Refresh data
        } catch (err) {
            const message = (axios.isAxiosError<ApiError>(err) && err.response?.data?.error)
                ? err.response.data.error
                : "An unknown error occurred during the transaction.";
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    // --- Render Logic ---
    const renderInitialSetup = () => (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, backgroundColor: '#f0f4f8' }}>
            <Typography variant="h6" gutterBottom>Initial Model Setup</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                No global model found. Upload an initial model (e.g., .h5) to set it on the blockchain and begin the first training round.
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Button component="label" variant="outlined" startIcon={<UploadFile />}>
                    Choose File
                    <input type="file" hidden onChange={handleFileChange} />
                </Button>
                {selectedFile && <Typography variant="body2">{selectedFile.name}</Typography>}
                <Button variant="contained" color="secondary" onClick={handleSetInitialModel} disabled={!selectedFile || isUploading}>
                    {isUploading ? <CircularProgress size={24} /> : 'Upload & Set Model'}
                </Button>
            </Box>
        </Paper>
    );

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
                                <Typography sx={{ wordBreak: 'break-all' }}><strong>Global Model CID:</strong> {isLoading ? <CircularProgress size={16} /> : status.cid || 'N/A'}</Typography>
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* --- MODIFIED: History Card now displays a Table --- */}
                    <Grid size={{ xs: 12, md: 6 }}>
                        <Card sx={{ height: '100%' }}>
                            <CardContent>
                                <Typography variant="h5" component="h2" gutterBottom>Global Models History</Typography>
                                {isLoading ? <CircularProgress /> : history.length > 0 ? (
                                    <TableContainer component={Paper} sx={{ maxHeight: 220 }}>
                                        <Table stickyHeader size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>Round</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>Final Global Model CID</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {history.slice().reverse().map((item) => (
                                                    <TableRow hover key={item.round}>
                                                        <TableCell>{item.round}</TableCell>
                                                        <TableCell sx={{ wordBreak: 'break-all' }}>{item.cid}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                ) : (
                                    <Typography variant="body2" color="text.secondary">No completed rounds yet.</Typography>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* --- MODIFIED: Actions Card is simplified --- */}
                    <Grid size={{ xs: 12, md: 6 }}>
                        <Card>
                            <CardContent>
                                <Typography variant="h5" gutterBottom>Admin Actions</Typography>
                                {/* The initial setup is now shown only if the CID is not set */}
                                {!status.cid && status.state === 'INACTIVE' && renderInitialSetup()}

                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Button
                                        variant="contained"
                                        onClick={handleStartRound}
                                        // The button requires a model to be set and the round to be inactive
                                        disabled={isSubmitting || !status.cid || status.state !== 'INACTIVE'}>
                                        {isSubmitting ? <CircularProgress size={24} /> : `Start Round ${parseInt(status.round, 10) + 1}`}
                                    </Button>
                                </Box>
                                <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
                                    The "Start Round" button is only enabled when a global model exists and the system is INACTIVE.
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>
            </Container>
        </>
    );
}

export default App;