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
    TextField,
    List,
    ListItem,
    ListItemText,
} from '@mui/material';
import { UploadFile, CheckCircle, RadioButtonUnchecked } from '@mui/icons-material';

// --- Constants and Type Definitions ---
const API_URL = 'http://192.168.1.250:3001/api';
const WS_URL = 'ws://192.168.1.250:3001';

interface SystemStatus {
    campaign: string;
    round: string;
    cid: string;
    state: string;
}

interface HistoryItem {
    campaignId: string;
    newState: string;
    txHash: string;
    timestamp: number; // Added timestamp
}

interface HistoryGlobalModel {
    campaignId: string;
    state: string;
    round: string;
    cid: string;
    txHash: string;
    timestamp: number; // Added timestamp
}

interface SystemState {
    status: SystemStatus;
    stateHistory: HistoryItem[];
    modelHistory: HistoryGlobalModel[];
    participants: string[];
    submissions: { [nodeAddress: string]: boolean };
}


interface ActionResponse {
    success: boolean;
    txHash?: string;
    initialModelCID?: string;
}

interface ApiError {
    error: string;
}

interface CampaignFormData {
    totalRounds: string;
    minSubmissions: string;
    submissionPeriod: string;
    initialModelCID: string;
}

// --- Component ---
const App: React.FC = () => {
    // --- State Management ---
    const [status, setStatus] = useState<SystemStatus>({ campaign: '...', round: '...', cid: '', state: '...' });
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [globalModels, setGlobalModels] = useState<HistoryGlobalModel[]>([]);
    const [participants, setParticipants] = useState<string[]>([]);
    const [submissions, setSubmissions] = useState<{ [nodeAddress: string]: boolean }>({});
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isCancelling, setIsCancelling] = useState<boolean>(false);
    const [isCreatingCampaign, setIsCreatingCampaign] = useState<boolean>(false);
    const [isUploading, setIsUploading] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [success, setSuccess] = useState<string>('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [formData, setFormData] = useState<CampaignFormData>({
        totalRounds: '10',
        minSubmissions: '1',
        submissionPeriod: '3600',
        initialModelCID: '',
    });

    useEffect(() => {
        const ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            console.log('WebSocket connection established. Registering as dashboard...');
            // This message tells the backend to add this connection to the broadcast list
            ws.send(JSON.stringify({ type: 'register_dashboard' }));
        };

        ws.onmessage = (event) => {
            try {
                // --- MODIFICATION: Destructure participants and submissions as well ---
                const { status: newStatus, stateHistory: newHistory, participants: newParticipants, modelHistory: newModels, submissions: newSubmissions } = JSON.parse(event.data);
                if (newStatus) setStatus(newStatus);
                if (newHistory) setHistory(newHistory);
                if (newParticipants) setParticipants(newParticipants);
                if (newModels) setGlobalModels(newModels);
                if (newSubmissions) setSubmissions(newSubmissions);
                // --- MODIFICATION: Pre-fill form with existing CID ---
                if (newStatus.cid && !formData.initialModelCID) {
                    setFormData(prev => ({ ...prev, initialModelCID: newStatus.cid }));
                }

                if (isLoading) setIsLoading(false);
            } catch (err) { /* ... */ }
        };

        ws.onerror = () => {
            setError('WebSocket connection error. Is the backend server running?');
            setIsLoading(false);
        };

        // Cleanup function
        return () => {
            ws.close();
        };
    }, [isLoading, formData.initialModelCID]); // Dependency array to manage connection lifecycle
    const handleFormChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = event.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };
    // --- Event Handlers ---
    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            setError("Please select a model file first.");
            return;
        }
        setSelectedFile(file);
        setError('');
        setSuccess('');
        setIsUploading(true);
        setError('');
        setSuccess('');

        const formData = new FormData();
        formData.append('modelFile', file);
        console.log("Uploading file:", file.name);
        try {
            // --- MODIFIED: Endpoint changed to `/set-initial-model` ---
            const response = await axios.post<ActionResponse>(`${API_URL}/upload`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (response.data.success && response.data.initialModelCID) {
                setSuccess(`Initial model set successfully! CID: ${response.data.initialModelCID}`);
                setSelectedFile(null); // Clear the file input
                const new_cid = response.data.initialModelCID;
                setFormData(prev => ({ ...prev, initialModelCID: new_cid }));
            }
        } catch (err) {
            const message = (axios.isAxiosError<ApiError>(err) && err.response?.data?.error)
                ? err.response.data.error
                : "An unknown error occurred during upload.";
            setError(message);
        } finally {
            setIsUploading(false);
            setSelectedFile(null);
        }
    };

    const handleCreateCampaign = async () => {
        setIsCreatingCampaign(true);
        // ...
        try {
            const payload = {
                participants,
                totalRounds: parseInt(formData.totalRounds, 10),
                minSubmissions: parseInt(formData.minSubmissions, 10),
                submissionPeriod: parseInt(formData.submissionPeriod, 10),
                initialModelCID: formData.initialModelCID,
            };
            const response = await axios.post<ActionResponse>(`${API_URL}/train`, payload);
            setSuccess(`New campaign started successfully! TxHash: ${response.data.txHash}`);
        } catch (err) { /* ... */ }
        finally { setIsCreatingCampaign(false); }
    };

    const handleCancelCampaign = async () => {
        setIsCancelling(true);
        setError('');
        setSuccess('');
        try {
            const response = await axios.post<ActionResponse>(`${API_URL}/cancel`);
            setSuccess(`Round successfully cancelled! TxHash: ${response.data.txHash}`);
        } catch (err) {
            const message = (axios.isAxiosError<ApiError>(err) && err.response?.data?.error)
                ? err.response.data.error
                : "An unknown error occurred while cancelling the round.";
            setError(message);
        } finally {
            setIsCancelling(false);
        }
    };

    console.log("Rendering App with status:", status.state);

    return (
        <>
            <CssBaseline />
            <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
                <Typography variant="h3" component="h1" gutterBottom align="center">
                    Federated Learning Control Panel
                </Typography>

                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

                <Grid container spacing={3}>
                    {/* Status Card */}
                    <Grid size={{ xs: 12, md: 6 }}>
                        <Card sx={{ height: '100%' }}>
                            <CardContent>
                                <Typography variant="h5" component="h2" gutterBottom>System Status</Typography>
                                <Typography><strong>Current Campaign:</strong> {isLoading ? <CircularProgress size={16} /> : status.campaign}</Typography>
                                <Typography><strong>Current Round:</strong> {isLoading ? <CircularProgress size={16} /> : status.round}</Typography>
                                <Typography><strong>Round State:</strong> {isLoading ? <CircularProgress size={16} /> : status.state}</Typography>
                                <Typography sx={{ wordBreak: 'break-all' }}><strong>Global Model CID:</strong> {isLoading ? <CircularProgress size={16} /> : status.cid || 'N/A'}</Typography>
                            </CardContent>
                        </Card>
                    </Grid>

                    <Grid size={{ xs: 12 }}>
                        <Card>
                            <CardContent>
                                <Typography variant="h5" gutterBottom>Create New Campaign</Typography>
                                <Grid container spacing={2}>
                                    {/* Column 1: Parameters */}
                                    <Grid size={{ xs: 12, md: 6 }}>
                                        <TextField name="totalRounds" label="Total Rounds" value={formData.totalRounds} onChange={handleFormChange} fullWidth margin="normal" type="number" />
                                        <TextField name="minSubmissions" label="Minimum Submissions" value={formData.minSubmissions} onChange={handleFormChange} fullWidth margin="normal" type="number" />
                                        <TextField name="submissionPeriod" label="Submission Period (seconds)" value={formData.submissionPeriod} onChange={handleFormChange} fullWidth margin="normal" type="number" />
                                    </Grid>
                                    {/* Column 2: Initial Model & Participants */}
                                    <Grid size={{ xs: 12, md: 6 }}>
                                        <TextField
                                            name="initialModelCID"
                                            label="Initial Model CID" // Corrected: Use a static, descriptive label.
                                            value={formData.initialModelCID || 'No Global Model'} // Display a message if the value is empty.
                                            fullWidth
                                            margin="normal"
                                            helperText={isUploading ? "Uploading..." : "Immutable — filled from last campaign or set by the system. Not editable via dashboard."}
                                            InputProps={{ readOnly: true }}
                                            disabled
                                        />
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, my: 1 }}>
                                            <Button component="label" variant="outlined" startIcon={<UploadFile />} disabled={(selectedFile !== null) || isUploading}>Choose File<input type="file" hidden onChange={handleFileChange} /></Button>
                                            {selectedFile && <Typography variant="body2">{selectedFile.name}</Typography>}
                                            {/* <Button onClick={handleSetInitialModel} disabled={!selectedFile || isUploading}>{isUploading ? <CircularProgress size={24} /> : 'Upload for CID'}</Button> */}
                                        </Box>
                                        <Typography variant="subtitle2" sx={{ mt: 2 }}>Connected Participants ({participants.length})</Typography>
                                        <Paper variant="outlined" sx={{ maxHeight: 100, overflow: 'auto' }}>
                                            <List dense>{participants.map(p => <ListItem key={p}><ListItemText primary={p} /></ListItem>)}</List>
                                        </Paper>
                                    </Grid>
                                </Grid>
                                <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
                                    <Button variant="contained" onClick={handleCreateCampaign} disabled={isCreatingCampaign || status.state !== 'INACTIVE' || participants.length === 0}>
                                        {isCreatingCampaign ? <CircularProgress size={24} /> : 'Start Campaign'}
                                    </Button>
                                    <Button variant="outlined" color="warning" onClick={handleCancelCampaign} disabled={isCancelling || ['INACTIVE', 'Error'].includes(status.state)}>
                                        {isCancelling ? <CircularProgress size={24} /> : 'Cancel Active Campaign'}
                                    </Button>
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* --- NEW: Training Node Submission Status Card --- */}
                    <Grid size={{ xs: 12 }}>
                        <Card>
                            <CardContent>
                                <Typography variant="h5" component="h2" gutterBottom>Training Node Submission Status</Typography>
                                <Typography variant="subtitle2" sx={{ mb: 2 }}>Round {status.round} • Campaign {status.campaign}</Typography>
                                {isLoading ? (
                                    <CircularProgress />
                                ) : participants.length === 0 ? (
                                    <Typography variant="body2" color="text.secondary">No participants connected yet.</Typography>
                                ) : status.state === 'INACTIVE' ? (
                                    <Typography variant="body2" color="text.secondary">No active campaign. Start a new campaign to see submission status.</Typography>
                                ) : (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                        {participants.map((participant) => {
                                            const hasSubmitted = submissions[participant] === true;
                                            return (
                                                <Box
                                                    key={participant}
                                                    sx={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 1.5,
                                                        p: 1.5,
                                                        borderRadius: 1,
                                                        backgroundColor: hasSubmitted ? 'rgba(76, 175, 80, 0.1)' : 'rgba(158, 158, 158, 0.1)',
                                                        border: `1px solid ${hasSubmitted ? '#4CAF50' : '#9E9E9E'}`,
                                                    }}
                                                >
                                                    {hasSubmitted ? (
                                                        <CheckCircle sx={{ color: '#4CAF50', fontSize: 24 }} />
                                                    ) : (
                                                        <RadioButtonUnchecked sx={{ color: '#9E9E9E', fontSize: 24 }} />
                                                    )}
                                                    <Box sx={{ flex: 1 }}>
                                                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                            {participant}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            {hasSubmitted ? '✓ Model submitted' : '○ Awaiting submission'}
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* --- History Card --- */}
                    <Grid size={{ xs: 12 }}>
                        <Card sx={{ height: '100%' }}>
                            <CardContent>
                                <Typography variant="h5" component="h2" gutterBottom>Campaign State History</Typography>
                                {isLoading ? <CircularProgress /> : history.length > 0 ? (
                                    <TableContainer component={Paper} sx={{ maxHeight: 220 }}>
                                        <Table stickyHeader size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>Transction Hash</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>Timestamp</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>Campaign</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>New State</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {history.slice().reverse().map((item) => (
                                                    <TableRow hover key={item.txHash}>
                                                        <TableCell>{item.txHash}</TableCell>
                                                        <TableCell>{item.timestamp}</TableCell>
                                                        <TableCell>{item.campaignId}</TableCell>
                                                        <TableCell>{item.newState}</TableCell>
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
                    <Grid size={{ xs: 12 }}>
                        <Card sx={{ height: '100%' }}>
                            <CardContent>
                                <Typography variant="h5" component="h2" gutterBottom>Global Model History</Typography>
                                {isLoading ? <CircularProgress /> : history.length > 0 ? (
                                    <TableContainer component={Paper} sx={{ maxHeight: 220 }}>
                                        <Table stickyHeader size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>Transction Hash</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>Timestamp</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>Campaign</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>State</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>Round</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>CID</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {globalModels.slice().reverse().map((item) => (
                                                    <TableRow hover key={item.txHash}>
                                                        <TableCell>{item.txHash}</TableCell>
                                                        <TableCell>{item.timestamp}</TableCell>
                                                        <TableCell>{item.campaignId}</TableCell>
                                                        <TableCell>{item.state}</TableCell>
                                                        <TableCell>{item.round}</TableCell>
                                                        <TableCell>{item.cid}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                ) : (
                                    <Typography variant="body2" color="text.secondary">No global model yet.</Typography>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>
            </Container>
        </>
    );
}

export default App;