using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Media;
using System.Windows.Forms;

namespace SuperVolleyBallPC
{
    public class PlayerData
    {
        public string Name;
        public int Number;
        public int SP;
        public int RE;
        public int SV;
        public int BL;

        public PlayerData(string name, int num, int sp, int re, int sv, int bl)
        {
            Name = name; Number = num; SP = sp; RE = re; SV = sv; BL = bl;
        }

        public PlayerData Clone()
        {
            return new PlayerData(Name, Number, SP, RE, SV, BL);
        }
    }

    public class TeamDef
    {
        public string Code;
        public string FullName;
        public string RomOffset;
        public Color JerseyPrimary;
        public Color JerseySecondary;
        public Color SkinColor;
        public List<PlayerData> Roster = new List<PlayerData>();

        public TeamDef(string code, string fullName, string offset, Color c1, Color c2, Color skin)
        {
            Code = code; FullName = fullName; RomOffset = offset;
            JerseyPrimary = c1; JerseySecondary = c2; SkinColor = skin;
        }
    }

    public class CourtPlayer
    {
        public PlayerData Data;
        public int Side;
        public int Slot;
        public float X, Y, Z;
        public float VX, VY;
        public float HomeX, HomeZ;
        public string State = "IDLE";
        public int AnimTimer = 0;
        public int Cooldown = 0;
    }

    public class TeamInstance
    {
        public TeamDef Def;
        public int Side;
        public bool IsCPU;
        public int SetsWon = 0;
        public int Points = 0;
        public int Touches = 0;
        public string SetPlan = "OPEN";
        public bool SuperUsed = false;
        public List<CourtPlayer> Players = new List<CourtPlayer>();
    }

    public class MainForm : Form
    {
        private Timer gameTimer;
        private List<TeamDef> teams = new List<TeamDef>();
        private string gameState = "TITLE"; // TITLE, MENU, SELECT, LEAGUE, MATCH, SET_OVER, CREDITS
        private int menuCursor = 0;
        private string gameMode = "1P_NORMAL"; // 1P_NORMAL, 1P_LEAGUE, 2P_NORMAL, WATCH
        private int p1TeamIdx = 2; // BRA
        private int p2TeamIdx = 0; // USA
        private int selectPhase = 1;
        private int leagueStage = 0;
        private List<int> leagueOpponents = new List<int>();

        private HashSet<Keys> keysDown = new HashSet<Keys>();
        private HashSet<Keys> keysJustPressed = new HashSet<Keys>();

        private const float WORLD_W = 1400f;
        private const float NET_X = 700f;
        private const float COURT_LEFT = 160f;
        private const float COURT_RIGHT = 1240f;
        private const float FLOOR_Y = 445f;
        private const float NET_TOP_Y = 290f;

        private float camX = 220f;
        private int frameCount = 0;
        private int crowdCheerTimer = 0;

        // Match state
        private TeamInstance[] matchTeams = new TeamInstance[2];
        private int servingSide = 0;
        private string rallyState = "PRE_SERVE";
        private int stateTimer = 60;
        private string callText = "SERVICE!";
        private string callSubText = "";
        private int callTimer = 60;
        private int currentSet = 1;
        private int lastHitterSide = 0;
        private string lastHitType = "SERVE";

        // Ball
        private float ballX, ballY, ballVX, ballVY, ballTargetX;
        private bool ballSuper = false;
        private string ballSuperType = "";
        private List<PointF> ballTrail = new List<PointF>();

        // In-memory synthesized WAV players for arcade SFX
        private Dictionary<string, SoundPlayer> sfxBank = new Dictionary<string, SoundPlayer>();
        private bool soundEnabled = true;

        public MainForm()
        {
            this.Text = "Super Volley Ball (Mega Drive / Genesis - GM T-30016-00) - PC Windows Edition";
            this.ClientSize = new Size(960, 580);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.DoubleBuffered = true;
            this.KeyPreview = true;
            this.BackColor = Color.FromArgb(7, 13, 25);

            BuildTopBar();
            InitRomTeamsData();
            InitSynthesizedSFX();

            this.KeyDown += OnKeyDownHandler;
            this.KeyUp += OnKeyUpHandler;

            gameTimer = new Timer();
            gameTimer.Interval = 16; // ~60 FPS
            gameTimer.Tick += OnGameTick;
            gameTimer.Start();
        }

        private void BuildTopBar()
        {
            Panel topBar = new Panel();
            topBar.Dock = DockStyle.Top;
            topBar.Height = 38;
            topBar.BackColor = Color.FromArgb(12, 24, 48);

            Label lblTitle = new Label();
            lblTitle.Text = "SEGA GENESIS • SUPER VOLLEY BALL (PC NATIVE .EXE)";
            lblTitle.ForeColor = Color.Yellow;
            lblTitle.Font = new Font("Consolas", 10f, FontStyle.Bold);
            lblTitle.AutoSize = true;
            lblTitle.Location = new Point(12, 10);
            topBar.Controls.Add(lblTitle);

            Button btnReset = CreateTopButton("Menu Inicial (ESC)", 420);
            btnReset.Click += delegate { gameState = "TITLE"; this.Focus(); };
            topBar.Controls.Add(btnReset);

            Button btnSound = CreateTopButton("Som: ON (M)", 565);
            btnSound.Click += delegate {
                soundEnabled = !soundEnabled;
                btnSound.Text = soundEnabled ? "Som: ON (M)" : "Som: OFF (M)";
                this.Focus();
            };
            topBar.Controls.Add(btnSound);

            Button btnWeb = CreateTopButton("Abrir Edição Web YM2612 + REA Inspector (F10)", 685);
            btnWeb.Width = 260;
            btnWeb.BackColor = Color.FromArgb(120, 0, 0);
            btnWeb.ForeColor = Color.Yellow;
            btnWeb.Click += delegate { LaunchWebEdition(); this.Focus(); };
            topBar.Controls.Add(btnWeb);

            this.Controls.Add(topBar);
        }

        private Button CreateTopButton(string text, int x)
        {
            Button b = new Button();
            b.Text = text;
            b.Location = new Point(x, 5);
            b.Size = new Size(138, 28);
            b.FlatStyle = FlatStyle.Flat;
            b.BackColor = Color.FromArgb(24, 48, 96);
            b.ForeColor = Color.White;
            b.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            b.TabStop = false;
            return b;
        }

        public void LaunchWebEdition()
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string htmlPath = Path.Combine(baseDir, "index.html");
                if (!File.Exists(htmlPath)) return;

                string[] browsers = new string[] {
                    @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                    @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                    @"C:\Program Files\Google\Chrome\Application\chrome.exe"
                };
                foreach (string br in browsers)
                {
                    if (File.Exists(br))
                    {
                        Process.Start(br, "--app=\"file:///" + htmlPath.Replace("\\", "/") + "\" --window-size=1020,720");
                        return;
                    }
                }
                Process.Start(htmlPath);
            }
            catch { }
        }

        // Dados extraídos diretamente da ROM "Super Volley Ball (USA).md" (0x14FBA - 0x15399)
        private void InitRomTeamsData()
        {
            // 0: USA (0x14FBA, Palette 9)
            TeamDef usa = new TeamDef("USA", "Estados Unidos (USA)", "0x14FBA", Color.FromArgb(0, 0, 252), Color.FromArgb(252, 0, 0), Color.FromArgb(252, 216, 180));
            usa.Roster.Add(new PlayerData("PATON", 5, 6, 6, 4, 6));
            usa.Roster.Add(new PlayerData("SABLE", 4, 6, 8, 5, 8));
            usa.Roster.Add(new PlayerData("TOMAS", 6, 8, 7, 5, 7));
            usa.Roster.Add(new PlayerData("BOCK", 7, 6, 7, 5, 7));
            usa.Roster.Add(new PlayerData("KELLY", 15, 8, 8, 6, 7));
            usa.Roster.Add(new PlayerData("STACK", 10, 6, 6, 4, 6));
            usa.Roster.Add(new PlayerData("TOWER", 1, 4, 4, 3, 4));
            usa.Roster.Add(new PlayerData("SUGAR", 11, 5, 8, 8, 5));
            teams.Add(usa);

            // 1: URS (0x14FCA, Palette 10)
            TeamDef urs = new TeamDef("URS", "União Soviética (URS)", "0x14FCA", Color.FromArgb(216, 0, 0), Color.FromArgb(252, 108, 108), Color.FromArgb(252, 180, 180));
            urs.Roster.Add(new PlayerData("ZADIG", 9, 7, 6, 6, 7));
            urs.Roster.Add(new PlayerData("SOROC", 10, 8, 6, 7, 6));
            urs.Roster.Add(new PlayerData("ANTOV", 11, 8, 7, 5, 7));
            urs.Roster.Add(new PlayerData("ITZAK", 1, 8, 7, 6, 6));
            urs.Roster.Add(new PlayerData("KANOV", 2, 7, 6, 7, 7));
            urs.Roster.Add(new PlayerData("ROSEV", 8, 6, 5, 5, 5));
            urs.Roster.Add(new PlayerData("VILDY", 7, 7, 5, 6, 8));
            urs.Roster.Add(new PlayerData("UVICH", 3, 5, 5, 5, 7));
            teams.Add(urs);

            // 2: BRA (0x14FDA, Palette 14)
            TeamDef bra = new TeamDef("BRA", "Brasil (BRA)", "0x14FDA", Color.FromArgb(252, 252, 0), Color.FromArgb(0, 108, 252), Color.FromArgb(216, 144, 108));
            bra.Roster.Add(new PlayerData("MONTE", 4, 6, 5, 6, 6));
            bra.Roster.Add(new PlayerData("DALMO", 6, 6, 4, 5, 6));
            bra.Roster.Add(new PlayerData("SAMBA", 8, 6, 7, 6, 7));
            bra.Roster.Add(new PlayerData("DALIA", 11, 7, 5, 6, 7));
            bra.Roster.Add(new PlayerData("BUERO", 12, 7, 3, 4, 7));
            bra.Roster.Add(new PlayerData("DESIO", 7, 5, 5, 6, 5));
            teams.Add(bra);

            // 3: HOL (0x14FEA, Palette 15)
            TeamDef hol = new TeamDef("HOL", "Holanda (HOL)", "0x14FEA", Color.FromArgb(252, 180, 0), Color.FromArgb(252, 252, 252), Color.FromArgb(252, 216, 180));
            hol.Roster.Add(new PlayerData("OLFER", 6, 6, 5, 5, 7));
            hol.Roster.Add(new PlayerData("BEUZE", 10, 4, 5, 3, 7));
            hol.Roster.Add(new PlayerData("VANDE", 15, 6, 6, 4, 7));
            hol.Roster.Add(new PlayerData("AREND", 7, 4, 5, 4, 7));
            hol.Roster.Add(new PlayerData("BLANK", 8, 5, 6, 5, 7));
            hol.Roster.Add(new PlayerData("BOSCH", 12, 4, 5, 3, 7));
            teams.Add(hol);

            // 4: FRA (0x14FFA, Palette 12)
            TeamDef fra = new TeamDef("FRA", "França (FRA)", "0x14FFA", Color.FromArgb(72, 108, 252), Color.FromArgb(252, 252, 252), Color.FromArgb(252, 216, 180));
            fra.Roster.Add(new PlayerData("BUPIN", 5, 8, 4, 3, 6));
            fra.Roster.Add(new PlayerData("DEKAR", 1, 6, 7, 4, 6));
            fra.Roster.Add(new PlayerData("JUNOT", 7, 5, 4, 5, 5));
            fra.Roster.Add(new PlayerData("MASON", 3, 4, 4, 4, 5));
            fra.Roster.Add(new PlayerData("TULUS", 9, 6, 3, 3, 4));
            fra.Roster.Add(new PlayerData("FABOR", 12, 4, 5, 5, 4));
            teams.Add(fra);

            // 5: ITA (0x1500A, Palette 13)
            TeamDef ita = new TeamDef("ITA", "Itália (ITA)", "0x1500A", Color.FromArgb(252, 252, 252), Color.FromArgb(0, 144, 252), Color.FromArgb(252, 216, 180));
            ita.Roster.Add(new PlayerData("FALCO", 1, 6, 3, 3, 6));
            ita.Roster.Add(new PlayerData("COSTA", 10, 7, 2, 3, 6));
            ita.Roster.Add(new PlayerData("BURDI", 9, 5, 3, 5, 4));
            ita.Roster.Add(new PlayerData("RICCI", 6, 4, 4, 4, 4));
            ita.Roster.Add(new PlayerData("SCALA", 11, 4, 3, 4, 4));
            ita.Roster.Add(new PlayerData("ZUCCO", 4, 3, 5, 5, 2));
            teams.Add(ita);

            // 6: JPN (0x1501A, Palette 8)
            TeamDef jpn = new TeamDef("JPN", "Japão (JPN)", "0x1501A", Color.FromArgb(252, 252, 252), Color.FromArgb(252, 0, 0), Color.FromArgb(252, 180, 144));
            jpn.Roster.Add(new PlayerData("SUZKI", 4, 8, 8, 2, 7));
            jpn.Roster.Add(new PlayerData("YAMHA", 2, 6, 7, 3, 4));
            jpn.Roster.Add(new PlayerData("MAZDA", 3, 6, 6, 5, 5));
            jpn.Roster.Add(new PlayerData("HONDA", 12, 7, 4, 6, 8));
            jpn.Roster.Add(new PlayerData("TOYOT", 10, 7, 5, 6, 6));
            jpn.Roster.Add(new PlayerData("NISAN", 5, 2, 5, 4, 2));
            jpn.Roster.Add(new PlayerData("MIFNE", 8, 7, 5, 4, 4));
            jpn.Roster.Add(new PlayerData("NINJA", 7, 7, 2, 5, 7));
            teams.Add(jpn);

            // 7: CHN (0x1502A, Palette 11)
            TeamDef chn = new TeamDef("CHN", "China (CHN)", "0x1502A", Color.FromArgb(216, 0, 0), Color.FromArgb(252, 216, 0), Color.FromArgb(252, 180, 144));
            chn.Roster.Add(new PlayerData("RIE", 1, 5, 3, 2, 4));
            chn.Roster.Add(new PlayerData("CHAN", 2, 4, 2, 3, 3));
            chn.Roster.Add(new PlayerData("CUEN", 3, 3, 2, 3, 5));
            chn.Roster.Add(new PlayerData("GO", 4, 3, 3, 4, 4));
            chn.Roster.Add(new PlayerData("FEN", 5, 4, 4, 2, 4));
            chn.Roster.Add(new PlayerData("RAO", 6, 2, 3, 3, 3));
            teams.Add(chn);

            // 8: ??? Secret URAWAZA Team (0x14F3A)
            TeamDef sec = new TeamDef("???", "Seleção Secreta URAWAZA (???)", "0x14F3A", Color.FromArgb(180, 0, 180), Color.FromArgb(252, 252, 0), Color.FromArgb(252, 180, 144));
            sec.Roster.Add(new PlayerData("TSUKA", 1, 8, 8, 8, 8));
            sec.Roster.Add(new PlayerData("NAKAM", 2, 8, 7, 8, 8));
            sec.Roster.Add(new PlayerData("ISHIM", 3, 8, 8, 7, 8));
            sec.Roster.Add(new PlayerData("OKUDA", 4, 8, 7, 8, 7));
            sec.Roster.Add(new PlayerData("ITAMU", 5, 8, 8, 8, 8));
            sec.Roster.Add(new PlayerData("VSYS", 6, 8, 8, 8, 8));
            teams.Add(sec);
        }

        private void InitSynthesizedSFX()
        {
            sfxBank["whistle"] = CreateToneWav(2850, 2980, 320, true);
            sfxBank["toss"] = CreateToneWav(260, 520, 110, false);
            sfxBank["receive"] = CreateToneWav(190, 75, 95, false);
            sfxBank["spike"] = CreateToneWav(360, 55, 160, true);
            sfxBank["super"] = CreateToneWav(520, 1240, 240, true);
            sfxBank["block"] = CreateToneWav(260, 90, 110, false);
            sfxBank["menu"] = CreateToneWav(660, 880, 55, false);
        }

        private SoundPlayer CreateToneWav(double fStart, double fEnd, int durationMs, bool vibrato)
        {
            int sampleRate = 22050;
            int numSamples = (sampleRate * durationMs) / 1000;
            MemoryStream ms = new MemoryStream();
            BinaryWriter bw = new BinaryWriter(ms);

            int byteRate = sampleRate * 2;
            bw.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));
            bw.Write(36 + numSamples * 2);
            bw.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt "));
            bw.Write(16);
            bw.Write((short)1);
            bw.Write((short)1);
            bw.Write(sampleRate);
            bw.Write(byteRate);
            bw.Write((short)2);
            bw.Write((short)16);
            bw.Write(System.Text.Encoding.ASCII.GetBytes("data"));
            bw.Write(numSamples * 2);

            double phase = 0;
            for (int i = 0; i < numSamples; i++)
            {
                double t = (double)i / numSamples;
                double freq = fStart + (fEnd - fStart) * t;
                if (vibrato) freq += Math.Sin(i * 0.08) * 95.0;
                phase += (2.0 * Math.PI * freq) / sampleRate;
                double env = Math.Pow(1.0 - t, 0.7);
                short val = (short)(Math.Sin(phase) * 9500 * env);
                bw.Write(val);
            }
            ms.Position = 0;
            return new SoundPlayer(ms);
        }

        private void PlaySFX(string key)
        {
            if (!soundEnabled) return;
            SoundPlayer sp;
            if (sfxBank.TryGetValue(key, out sp))
            {
                try { sp.Play(); } catch { }
            }
        }

        private void OnKeyDownHandler(object sender, KeyEventArgs e)
        {
            if (!keysDown.Contains(e.KeyCode))
            {
                keysJustPressed.Add(e.KeyCode);
            }
            keysDown.Add(e.KeyCode);

            if (e.KeyCode == Keys.F10) LaunchWebEdition();
            if (e.KeyCode == Keys.M) soundEnabled = !soundEnabled;
            if (e.KeyCode == Keys.Escape && gameState != "TITLE") gameState = "MENU";
        }

        private void OnKeyUpHandler(object sender, KeyEventArgs e)
        {
            keysDown.Remove(e.KeyCode);
        }

        private bool IsPressed(Keys k) { return keysJustPressed.Contains(k); }
        private bool IsHeld(Keys k) { return keysDown.Contains(k); }

        private void OnGameTick(object sender, EventArgs e)
        {
            frameCount++;
            if (gameState == "MATCH")
            {
                UpdateMatch();
            }
            else
            {
                UpdateMenus();
            }
            keysJustPressed.Clear();
            this.Invalidate();
        }

        private void UpdateMenus()
        {
            if (gameState == "TITLE")
            {
                if (IsPressed(Keys.Enter) || IsPressed(Keys.Space) || IsPressed(Keys.Z))
                {
                    PlaySFX("menu");
                    gameState = "MENU";
                    menuCursor = 0;
                }
            }
            else if (gameState == "MENU")
            {
                if (IsPressed(Keys.Up) || IsPressed(Keys.W)) { menuCursor = (menuCursor + 4) % 5; PlaySFX("menu"); }
                if (IsPressed(Keys.Down) || IsPressed(Keys.S)) { menuCursor = (menuCursor + 1) % 5; PlaySFX("menu"); }
                if (IsPressed(Keys.Enter) || IsPressed(Keys.Z) || IsPressed(Keys.Space))
                {
                    PlaySFX("menu");
                    if (menuCursor == 0) { gameMode = "1P_NORMAL"; selectPhase = 1; gameState = "SELECT"; }
                    else if (menuCursor == 1) { gameMode = "1P_LEAGUE"; selectPhase = 1; gameState = "SELECT"; }
                    else if (menuCursor == 2) { gameMode = "2P_NORMAL"; selectPhase = 1; gameState = "SELECT"; }
                    else if (menuCursor == 3) { gameMode = "WATCH"; selectPhase = 1; gameState = "SELECT"; }
                    else if (menuCursor == 4) { gameState = "CREDITS"; }
                }
            }
            else if (gameState == "SELECT")
            {
                int total = teams.Count;
                if (selectPhase == 1)
                {
                    if (IsPressed(Keys.Left) || IsPressed(Keys.A)) { p1TeamIdx = (p1TeamIdx - 1 + total) % total; PlaySFX("menu"); }
                    if (IsPressed(Keys.Right) || IsPressed(Keys.D)) { p1TeamIdx = (p1TeamIdx + 1) % total; PlaySFX("menu"); }
                    if (IsPressed(Keys.Enter) || IsPressed(Keys.Z) || IsPressed(Keys.Space))
                    {
                        PlaySFX("menu");
                        if (gameMode == "1P_LEAGUE")
                        {
                            leagueStage = 0;
                            leagueOpponents.Clear();
                            for (int i = 0; i < total; i++) if (i != p1TeamIdx) leagueOpponents.Add(i);
                            p2TeamIdx = leagueOpponents[0];
                            StartMatch();
                        }
                        else
                        {
                            selectPhase = 2;
                            p2TeamIdx = (p1TeamIdx + 1) % 8;
                        }
                    }
                }
                else
                {
                    if (IsPressed(Keys.Left) || IsPressed(Keys.A)) { p2TeamIdx = (p2TeamIdx - 1 + total) % total; PlaySFX("menu"); }
                    if (IsPressed(Keys.Right) || IsPressed(Keys.D)) { p2TeamIdx = (p2TeamIdx + 1) % total; PlaySFX("menu"); }
                    if (IsPressed(Keys.Enter) || IsPressed(Keys.Z) || IsPressed(Keys.Space))
                    {
                        PlaySFX("menu");
                        StartMatch();
                    }
                }
            }
            else if (gameState == "SET_OVER")
            {
                if (IsPressed(Keys.Enter) || IsPressed(Keys.Z) || IsPressed(Keys.Space))
                {
                    PlaySFX("menu");
                    if (matchTeams[0].SetsWon >= 2 || matchTeams[1].SetsWon >= 2)
                    {
                        if (gameMode == "1P_LEAGUE" && matchTeams[0].SetsWon > matchTeams[1].SetsWon)
                        {
                            leagueStage++;
                            if (leagueStage < leagueOpponents.Count)
                            {
                                p2TeamIdx = leagueOpponents[leagueStage];
                                StartMatch();
                            }
                            else gameState = "CREDITS";
                        }
                        else gameState = "MENU";
                    }
                    else
                    {
                        currentSet++;
                        matchTeams[0].Points = 0;
                        matchTeams[1].Points = 0;
                        matchTeams[0].SuperUsed = false;
                        matchTeams[1].SuperUsed = false;
                        SetupServe(currentSet % 2 == 1 ? 0 : 1);
                        gameState = "MATCH";
                    }
                }
            }
            else if (gameState == "CREDITS")
            {
                if (IsPressed(Keys.Enter) || IsPressed(Keys.Z) || IsPressed(Keys.Space))
                {
                    gameState = "MENU";
                }
            }
        }

        private TeamInstance BuildTeamInstance(int idx, int side, bool cpu)
        {
            TeamDef def = teams[idx];
            TeamInstance ti = new TeamInstance();
            ti.Def = def;
            ti.Side = side;
            ti.IsCPU = cpu;

            float[] hx0 = new float[] { 230, 350, 595, 470, 635, 540 };
            float[] hx1 = new float[] { 1170, 1050, 805, 930, 765, 860 };
            float[] hz = new float[] { 12, -14, -18, 18, 0, 15 };

            for (int i = 0; i < 6; i++)
            {
                CourtPlayer cp = new CourtPlayer();
                cp.Data = def.Roster[i % def.Roster.Count].Clone();
                cp.Side = side;
                cp.Slot = i;
                cp.HomeX = side == 0 ? hx0[i] : hx1[i];
                cp.HomeZ = hz[i];
                cp.X = cp.HomeX;
                cp.Y = FLOOR_Y;
                cp.Z = cp.HomeZ;
                ti.Players.Add(cp);
            }
            return ti;
        }

        private void StartMatch()
        {
            matchTeams[0] = BuildTeamInstance(p1TeamIdx, 0, gameMode == "WATCH");
            matchTeams[1] = BuildTeamInstance(p2TeamIdx, 1, gameMode != "2P_NORMAL");
            currentSet = 1;
            SetupServe(0);
            gameState = "MATCH";
            PlaySFX("whistle");
        }

        private void SetupServe(int srvSide)
        {
            servingSide = srvSide;
            rallyState = "PRE_SERVE";
            stateTimer = 55;
            matchTeams[0].Touches = 0;
            matchTeams[1].Touches = 0;
            matchTeams[0].SetPlan = "OPEN";
            matchTeams[1].SetPlan = "OPEN";

            for (int s = 0; s < 2; s++)
            {
                foreach (CourtPlayer p in matchTeams[s].Players)
                {
                    p.X = p.HomeX;
                    p.Y = FLOOR_Y;
                    p.VX = 0; p.VY = 0;
                    p.State = "IDLE";
                    p.Cooldown = 0;
                }
            }
            CourtPlayer srv = matchTeams[srvSide].Players[0];
            srv.X = srvSide == 0 ? COURT_LEFT - 32 : COURT_RIGHT + 32;
            ballX = srv.X + (srvSide == 0 ? 14 : -14);
            ballY = FLOOR_Y - 52;
            ballVX = 0; ballVY = 0;
            ballSuper = false;
            ballSuperType = "";
            ballTrail.Clear();
            ballTargetX = srvSide == 0 ? 960 : 440;
            callText = "SERVICE!";
            callSubText = matchTeams[srvSide].Def.Code + " - #" + srv.Data.Number + " " + srv.Data.Name;
            callTimer = 50;
        }

        private void RotateTeam(TeamInstance t)
        {
            PlayerData first = t.Players[0].Data;
            for (int i = 0; i < 5; i++) t.Players[i].Data = t.Players[i + 1].Data;
            t.Players[5].Data = first;
        }

        private float PredictLandingX(float bx, float by, float vx, float vy, float g)
        {
            float dy = (FLOOR_Y - 12f) - by;
            float disc = vy * vy + 2f * g * dy;
            if (disc < 0) return bx + vx * 30f;
            float t = (-vy + (float)Math.Sqrt(disc)) / g;
            return bx + vx * Math.Max(1f, t);
        }

        private int GetClosestPlayer(TeamInstance t, float tx)
        {
            int best = 0;
            float bestD = 999999f;
            for (int i = 0; i < 6; i++)
            {
                float d = Math.Abs(t.Players[i].X - tx);
                if (d < bestD) { bestD = d; best = i; }
            }
            return best;
        }

        private void UpdateMatch()
        {
            if (callTimer > 0) callTimer--;
            if (crowdCheerTimer > 0) crowdCheerTimer--;

            float GRAV = 0.36f;
            float targetCam = Math.Max(0f, Math.Min(WORLD_W - 960f, ballX - 480f));
            camX += (targetCam - camX) * 0.12f;

            if (rallyState == "PRE_SERVE")
            {
                TeamInstance st = matchTeams[servingSide];
                CourtPlayer srv = st.Players[0];
                if (!st.IsCPU)
                {
                    if (IsHeld(Keys.Left) || IsHeld(Keys.A)) srv.X -= 2.5f;
                    if (IsHeld(Keys.Right) || IsHeld(Keys.D)) srv.X += 2.5f;
                    if (servingSide == 0) srv.X = Math.Max(70f, Math.Min(COURT_LEFT - 10f, srv.X));
                    else srv.X = Math.Max(COURT_RIGHT + 10f, Math.Min(WORLD_W - 70f, srv.X));
                    ballX = srv.X + (servingSide == 0 ? 14 : -14);
                    ballY = srv.Y - 52f;

                    if (IsPressed(Keys.Z) || IsPressed(Keys.Space) || IsPressed(Keys.X) || IsPressed(Keys.C))
                    {
                        bool isSup = IsPressed(Keys.C) && !st.SuperUsed;
                        rallyState = "SERVE_TOSS";
                        ballVY = isSup ? -13.5f : -8.5f;
                        ballVX = IsPressed(Keys.X) ? (servingSide == 0 ? 2.0f : -2.0f) : 0f;
                        ballSuperType = isSup ? "MILKY_PREP" : "";
                        PlaySFX("toss");
                    }
                }
                else
                {
                    stateTimer--;
                    if (stateTimer <= 0)
                    {
                        rallyState = "SERVE_TOSS";
                        ballVY = -8.5f;
                        ballVX = servingSide == 0 ? 1.5f : -1.5f;
                        PlaySFX("toss");
                    }
                }
                return;
            }

            if (rallyState == "SERVE_TOSS")
            {
                TeamInstance st = matchTeams[servingSide];
                CourtPlayer srv = st.Players[0];
                int dir = servingSide == 0 ? 1 : -1;

                ballX += ballVX;
                ballY += ballVY;
                ballVY += GRAV;

                if (!st.IsCPU)
                {
                    if (IsPressed(Keys.X) && srv.Y >= FLOOR_Y) { srv.VY = -8.8f; srv.VX = dir * 2.0f; srv.State = "JUMP"; }
                    if ((IsPressed(Keys.Z) || IsPressed(Keys.Space) || IsPressed(Keys.X) || IsPressed(Keys.C)) && ballY < FLOOR_Y - 25f)
                    {
                        bool trigSup = (ballSuperType == "MILKY_PREP" || IsPressed(Keys.C)) && !st.SuperUsed;
                        ExecuteServeHit(st, srv, trigSup);
                        return;
                    }
                }
                else
                {
                    if (ballVY > -1.0f && Math.Abs(ballY - (srv.Y - 68f)) < 36f)
                    {
                        ExecuteServeHit(st, srv, false);
                        return;
                    }
                }

                if (ballY >= FLOOR_Y - 12f) SetupServe(servingSide);
                UpdatePlayers(GRAV);
                return;
            }

            if (rallyState == "IN_PLAY")
            {
                ballTrail.Add(new PointF(ballX, ballY));
                if (ballTrail.Count > 9) ballTrail.RemoveAt(0);

                if (ballSuper && ballSuperType == "MILKY" && ballVY > 0)
                {
                    ballX += (float)Math.Sin(frameCount * 0.45) * 4.5f;
                }

                ballX += ballVX;
                ballY += ballVY;
                ballVY += GRAV;
                ballTargetX = PredictLandingX(ballX, ballY, ballVX, ballVY, GRAV);

                // Colisão com a rede
                if (Math.Abs(ballX - NET_X) < 10f && ballY >= NET_TOP_Y - 8f)
                {
                    if (ballY < NET_TOP_Y + 14f)
                    {
                        ballVX *= 0.45f;
                        ballVY = -Math.Abs(ballVY) * 0.45f - 2.0f;
                        ballSuper = false;
                        PlaySFX("block");
                    }
                    else
                    {
                        ballVX = -ballVX * 0.35f;
                        ballX = ballX < NET_X ? NET_X - 11f : NET_X + 11f;
                        ballSuper = false;
                        PlaySFX("block");
                    }
                }

                UpdatePlayers(GRAV);
                CheckBallInteractions(GRAV);

                if (ballY >= FLOOR_Y - 10f)
                {
                    ballY = FLOOR_Y - 10f;
                    HandleFloorContact();
                }
                return;
            }

            if (rallyState == "POINT_SCORED")
            {
                ballX += ballVX * 0.6f;
                ballY += ballVY;
                ballVY += GRAV;
                if (ballY >= FLOOR_Y - 10f) { ballY = FLOOR_Y - 10f; ballVY = -Math.Abs(ballVY) * 0.4f; }
                UpdatePlayers(GRAV);
                stateTimer--;
                if (stateTimer <= 0)
                {
                    SetupServe(servingSide);
                    PlaySFX("whistle");
                }
            }
        }

        private void ExecuteServeHit(TeamInstance st, CourtPlayer srv, bool isSup)
        {
            int dir = st.Side == 0 ? 1 : -1;
            rallyState = "IN_PLAY";
            lastHitType = "SERVE";
            lastHitterSide = st.Side;
            srv.State = "SPIKE";
            srv.AnimTimer = 20;

            if (isSup)
            {
                st.SuperUsed = true;
                ballSuper = true;
                ballSuperType = "MILKY";
                ballVX = dir * 9.2f;
                ballVY = -15.2f;
                callText = "MIRACLE SERVE! (MAKYUU)";
                callSubText = srv.Data.Name;
                callTimer = 50;
                PlaySFX("super");
            }
            else if (srv.Y < FLOOR_Y - 8f)
            {
                ballSuper = false;
                ballVX = dir * (11.0f + srv.Data.SV * 0.35f);
                ballVY = -6.8f;
                callText = "JUMP SERVE!";
                callSubText = srv.Data.Name;
                callTimer = 40;
                PlaySFX("spike");
            }
            else
            {
                ballSuper = false;
                ballVX = dir * (9.4f + srv.Data.SV * 0.25f);
                ballVY = -9.6f;
                PlaySFX("receive");
            }
        }

        private void UpdatePlayers(float GRAV)
        {
            int ballSide = ballX < NET_X ? 0 : 1;
            for (int s = 0; s < 2; s++)
            {
                TeamInstance t = matchTeams[s];
                int activeIdx = GetClosestPlayer(t, ballTargetX);

                if (!t.IsCPU && ballSide == s && t.Touches == 1)
                {
                    if (IsHeld(Keys.Down) || IsHeld(Keys.S)) t.SetPlan = "QUICK";
                    else if (IsHeld(Keys.Left) || IsHeld(Keys.A)) t.SetPlan = "BACK";
                    else if (IsHeld(Keys.Up) || IsHeld(Keys.W)) t.SetPlan = "OPEN";
                }

                for (int i = 0; i < 6; i++)
                {
                    CourtPlayer p = t.Players[i];
                    if (p.Cooldown > 0) p.Cooldown--;
                    if (p.AnimTimer > 0) p.AnimTimer--;

                    if (p.Y < FLOOR_Y || p.VY != 0)
                    {
                        p.X += p.VX;
                        p.Y += p.VY;
                        p.VY += GRAV * 1.15f;
                        if (p.Y >= FLOOR_Y)
                        {
                            p.Y = FLOOR_Y; p.VY = 0; p.VX = 0;
                            p.State = "IDLE";
                        }
                    }
                    else if (p.State == "DIVE")
                    {
                        p.X += p.VX;
                        p.VX *= 0.88f;
                        if (p.AnimTimer <= 0) { p.State = "IDLE"; p.VX = 0; }
                    }
                    else if (rallyState == "IN_PLAY")
                    {
                        float spd = 3.2f + p.Data.RE * 0.22f;
                        if (!t.IsCPU && i == activeIdx && ballSide == s)
                        {
                            bool moved = false;
                            if (IsHeld(Keys.Left) || IsHeld(Keys.A)) { p.X -= spd * 1.25f; moved = true; }
                            if (IsHeld(Keys.Right) || IsHeld(Keys.D)) { p.X += spd * 1.25f; moved = true; }
                            if (!moved)
                            {
                                float dx = ballTargetX - p.X;
                                if (Math.Abs(dx) > 12f) p.X += Math.Sign(dx) * spd * 0.78f;
                            }
                            if ((IsPressed(Keys.Z) || IsPressed(Keys.Space)) && ballY > FLOOR_Y - 120f && Math.Abs(ballX - p.X) > 42f && Math.Abs(ballX - p.X) < 135f)
                            {
                                p.State = "DIVE"; p.AnimTimer = 22; p.VX = Math.Sign(ballX - p.X) * 8.2f;
                            }
                            if (IsPressed(Keys.X) && p.Y >= FLOOR_Y)
                            {
                                p.VY = -(9.0f + p.Data.SP * 0.25f);
                                p.State = "JUMP";
                            }
                        }
                        else
                        {
                            if (ballSide == s)
                            {
                                if (i == activeIdx || (t.Touches == 1 && i == 2))
                                {
                                    float dx = ballTargetX - p.X;
                                    if (Math.Abs(dx) > 8f) p.X += Math.Sign(dx) * spd;
                                }
                                if (t.Touches == 2 && (i == activeIdx || i == 4) && p.Y >= FLOOR_Y && ballY < FLOOR_Y - 75f && Math.Abs(ballX - p.X) < 55f && ballVY > -2.5f)
                                {
                                    if (t.IsCPU || i != activeIdx)
                                    {
                                        p.VY = -(9.2f + p.Data.SP * 0.25f);
                                        p.State = "JUMP";
                                    }
                                }
                            }
                            else
                            {
                                p.X += Math.Sign(p.HomeX - p.X) * Math.Min(spd * 0.7f, Math.Abs(p.HomeX - p.X));
                                if (t.IsCPU && (i == 4 || i == 5) && matchTeams[1 - s].Touches >= 2 && ballY < FLOOR_Y - 85f && Math.Abs(ballX - NET_X) < 180f && p.Y >= FLOOR_Y)
                                {
                                    if (frameCount % 9 == 0) { p.VY = -(8.5f + p.Data.BL * 0.25f); p.State = "BLOCK"; }
                                }
                            }
                        }

                        if (!t.IsCPU && ballSide != s && (i == 4 || i == 5) && IsPressed(Keys.X) && p.Y >= FLOOR_Y)
                        {
                            p.VY = -(8.6f + p.Data.BL * 0.25f);
                            p.State = "BLOCK";
                        }
                    }

                    if (s == 0) p.X = Math.Max(55f, Math.Min(NET_X - 20f, p.X));
                    else p.X = Math.Max(NET_X + 20f, Math.Min(WORLD_W - 55f, p.X));
                }
            }
        }

        private void CheckBallInteractions(float GRAV)
        {
            int ballSide = ballX < NET_X ? 0 : 1;

            // 1. Bloqueio na rede
            for (int s = 0; s < 2; s++)
            {
                TeamInstance t = matchTeams[s];
                if (lastHitterSide != s && Math.Abs(ballX - NET_X) < 52f && ballY < NET_TOP_Y + 45f)
                {
                    foreach (CourtPlayer p in t.Players)
                    {
                        if (p.Y < FLOOR_Y - 22f && p.Cooldown == 0 && Math.Abs(p.X - ballX) < 42f && Math.Abs((p.Y - 68f) - ballY) < 42f)
                        {
                            p.Cooldown = 25;
                            int dir = s == 0 ? 1 : -1;
                            ballVX = dir * (6.5f + p.Data.BL * 0.4f);
                            ballVY = 4.0f;
                            ballSuper = false;
                            lastHitType = "BLOCK";
                            lastHitterSide = s;
                            callText = "SHUTOUT BLOCK!";
                            callSubText = p.Data.Name + " (BL " + p.Data.BL + ")";
                            callTimer = 45;
                            PlaySFX("block");
                            return;
                        }
                    }
                }
            }

            // 2. Recepção, Levantamento e Cortada
            TeamInstance team = matchTeams[ballSide];
            int dirSide = ballSide == 0 ? 1 : -1;
            foreach (CourtPlayer p in team.Players)
            {
                if (p.Cooldown > 0) continue;
                float hitY = p.Y < FLOOR_Y ? p.Y - 64f : (p.State == "DIVE" ? FLOOR_Y - 18f : FLOOR_Y - 44f);
                float rx = p.State == "DIVE" ? 54f : 38f;
                float ry = p.Y < FLOOR_Y ? 44f : 36f;

                if (Math.Abs(ballX - p.X) <= rx && Math.Abs(ballY - hitY) <= ry)
                {
                    if (p.Y < FLOOR_Y - 12f && team.Touches >= 1)
                    {
                        p.Cooldown = 26;
                        p.State = "SPIKE";
                        team.Touches = 0;
                        lastHitType = "SPIKE";
                        lastHitterSide = ballSide;

                        bool isSup = !team.SuperUsed && (!team.IsCPU ? IsHeld(Keys.C) : (p.Data.SP >= 7 && frameCount % 5 == 0));
                        if (isSup)
                        {
                            team.SuperUsed = true;
                            ballSuper = true;
                            ballSuperType = "LIGHTNING";
                            ballVX = dirSide * (14.2f + p.Data.SP * 0.45f);
                            ballVY = 5.0f;
                            callText = "LIGHTNING SPIKE!";
                            callSubText = p.Data.Name + " #" + p.Data.Number;
                            callTimer = 50;
                            PlaySFX("super");
                        }
                        else
                        {
                            ballSuper = false;
                            ballVX = dirSide * (10.2f + p.Data.SP * 0.42f);
                            ballVY = 2.8f + (8 - p.Data.SP) * 0.25f;
                            callText = "POWER SPIKE!";
                            callSubText = p.Data.Name + " #" + p.Data.Number;
                            callTimer = 40;
                            PlaySFX("spike");
                        }
                        return;
                    }

                    if (ballVY > -2.0f)
                    {
                        p.Cooldown = 22;
                        team.Touches++;
                        lastHitterSide = ballSide;

                        if (team.Touches == 1)
                        {
                            p.State = "RECEIVE"; p.AnimTimer = 18;
                            float setterX = ballSide == 0 ? NET_X - 95f : NET_X + 95f;
                            ballVX = (setterX - ballX) / 56f;
                            ballVY = -10.2f;
                            ballSuper = false;
                            lastHitType = "RECEIVE";
                            PlaySFX("receive");
                            return;
                        }
                        else if (team.Touches == 2)
                        {
                            p.State = "TOSS"; p.AnimTimer = 20;
                            lastHitType = "TOSS";
                            float atkX = team.SetPlan == "QUICK" ? (ballSide == 0 ? NET_X - 55f : NET_X + 55f) :
                                         team.SetPlan == "BACK" ? (ballSide == 0 ? NET_X - 210f : NET_X + 210f) :
                                         (ballSide == 0 ? NET_X - 115f : NET_X + 115f);
                            float frames = team.SetPlan == "QUICK" ? 34f : 56f;
                            ballVX = (atkX - ballX) / frames;
                            ballVY = team.SetPlan == "QUICK" ? -7.6f : -11.2f;
                            PlaySFX("toss");
                            return;
                        }
                        else
                        {
                            float oppX = ballSide == 0 ? NET_X + 280f : NET_X - 280f;
                            ballVX = (oppX - ballX) / 62f;
                            ballVY = -11.2f;
                            ballSuper = false;
                            team.Touches = 0;
                            PlaySFX("receive");
                            return;
                        }
                    }
                }
            }
        }

        private void HandleFloorContact()
        {
            rallyState = "POINT_SCORED";
            stateTimer = 85;
            crowdCheerTimer = 75;
            PlaySFX("whistle");

            bool isOut = ballX < COURT_LEFT - 8f || ballX > COURT_RIGHT + 8f;
            int landedSide = ballX < NET_X ? 0 : 1;
            int winner = isOut ? (1 - lastHitterSide) : (1 - landedSide);

            callText = isOut ? "OUT!" : "IN! POINT!";
            if (winner != servingSide)
            {
                RotateTeam(matchTeams[winner]);
                servingSide = winner;
                callSubText = matchTeams[winner].Def.Code + " SERVICE & POINT!";
            }
            else
            {
                callSubText = matchTeams[winner].Def.Code + " SCORES!";
            }

            matchTeams[winner].Points++;

            int p0 = matchTeams[0].Points;
            int p1 = matchTeams[1].Points;
            if ((p0 >= 15 || p1 >= 15) && (Math.Abs(p0 - p1) >= 2 || p0 >= 17 || p1 >= 17))
            {
                int setWin = p0 > p1 ? 0 : 1;
                matchTeams[setWin].SetsWon++;
                gameState = "SET_OVER";
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TranslateTransform(0, 38); // Abaixo da barra de ferramentas

            if (gameState == "TITLE") DrawTitle(g);
            else if (gameState == "MENU") DrawMenu(g);
            else if (gameState == "SELECT") DrawSelect(g);
            else if (gameState == "MATCH") DrawMatch(g);
            else if (gameState == "SET_OVER") DrawSetOver(g);
            else if (gameState == "CREDITS") DrawCredits(g);
        }

        private void DrawTextCentered(Graphics g, string txt, float x, float y, float size, Brush brush)
        {
            using (Font f = new Font("Consolas", size, FontStyle.Bold))
            {
                SizeF sz = g.MeasureString(txt, f);
                g.DrawString(txt, f, Brushes.Black, x - sz.Width / 2f + 2f, y + 2f);
                g.DrawString(txt, f, brush, x - sz.Width / 2f, y);
            }
        }

        private void DrawTitle(Graphics g)
        {
            g.Clear(Color.FromArgb(0, 24, 52));
            using (SolidBrush boxBrush = new SolidBrush(Color.FromArgb(144, 0, 0)))
            using (Pen goldPen = new Pen(Color.Yellow, 4f))
            {
                g.FillRectangle(boxBrush, 150, 60, 660, 150);
                g.DrawRectangle(goldPen, 150, 60, 660, 150);
            }
            DrawTextCentered(g, "SEGA GENESIS / MEGA DRIVE (GM T-30016-00)", 480, 78, 12f, Brushes.Cyan);
            DrawTextCentered(g, "SUPER VOLLEY BALL", 480, 108, 36f, Brushes.White);
            DrawTextCentered(g, "PC WINDOWS NATIVE EDITION  •  REA REVERSE ENGINEERED", 480, 172, 12f, Brushes.Yellow);

            for (int i = 0; i < 8; i++)
            {
                int fx = 120 + i * 92;
                using (SolidBrush tb = new SolidBrush(teams[i].JerseyPrimary))
                {
                    g.FillRectangle(tb, fx, 280, 72, 42);
                    g.DrawRectangle(Pens.White, fx, 280, 72, 42);
                }
                DrawTextCentered(g, teams[i].Code, fx + 36, 330, 12f, Brushes.White);
            }

            if ((frameCount / 25) % 2 == 0)
            {
                DrawTextCentered(g, "PRESSIONE ENTER / Z / ESPAÇO PARA INICIAR", 480, 410, 18f, Brushes.Yellow);
            }
            DrawTextCentered(g, "(C) 1991 VIDEO SYSTEM CO., LTD. • LICENSED BY SEGA ENTERPRISES, LTD.", 480, 490, 10f, Brushes.LightGray);
        }

        private void DrawMenu(Graphics g)
        {
            g.Clear(Color.FromArgb(0, 27, 54));
            DrawTextCentered(g, "SUPER VOLLEY BALL - MENU PRINCIPAL (0x12EE0)", 480, 45, 22f, Brushes.Yellow);

            string[] items = new string[] {
                "1 PLAYER - NORMAL GAME (EXIBIÇÃO)",
                "1 PLAYER - WORLD LEAGUE (TORNEIO MUNDIAL)",
                "2 PLAYERS - 1P VS 2P LOCAL",
                "WATCH A GAME (CPU VS CPU)",
                "STAFF CREDITS (ROM 0x14DA0)"
            };

            for (int i = 0; i < items.Length; i++)
            {
                int y = 135 + i * 58;
                bool act = menuCursor == i;
                using (SolidBrush b = new SolidBrush(act ? Color.FromArgb(144, 0, 0) : Color.FromArgb(0, 45, 90)))
                {
                    g.FillRectangle(b, 200, y, 560, 42);
                    g.DrawRectangle(act ? Pens.Yellow : Pens.DodgerBlue, 200, y, 560, 42);
                }
                DrawTextCentered(g, items[i], 480, y + 9, 14f, act ? Brushes.Yellow : Brushes.White);
            }
            DrawTextCentered(g, "DICA: Pressione F10 para abrir a Edição Web com Sintetizador FM YM2612 e REA Inspector!", 480, 475, 11f, Brushes.Cyan);
        }

        private void DrawSelect(Graphics g)
        {
            g.Clear(Color.FromArgb(0, 24, 48));
            DrawTextCentered(g, selectPhase == 1 ? "SELECIONE SUA SELEÇÃO (1P)" : "SELECIONE O ADVERSÁRIO (2P / CPU)", 480, 25, 20f, Brushes.Yellow);

            for (int i = 0; i < teams.Count; i++)
            {
                int col = i % 3;
                int row = i / 3;
                int x = 140 + col * 240;
                int y = 75 + row * 82;
                bool isP1 = p1TeamIdx == i;
                bool isP2 = selectPhase == 2 && p2TeamIdx == i;

                using (SolidBrush b = new SolidBrush(isP1 ? Color.FromArgb(0, 90, 180) : isP2 ? Color.FromArgb(160, 30, 30) : Color.FromArgb(0, 40, 80)))
                {
                    g.FillRectangle(b, x, y, 200, 68);
                    g.DrawRectangle(isP1 ? Pens.Cyan : isP2 ? Pens.Red : Pens.RoyalBlue, x, y, 200, 68);
                }
                DrawTextCentered(g, teams[i].Code + " - " + teams[i].FullName.Split('(')[0].Trim(), x + 100, y + 14, 12f, Brushes.White);
                DrawTextCentered(g, "ROM " + teams[i].RomOffset, x + 100, y + 38, 9.5f, Brushes.Yellow);
            }

            TeamDef focus = teams[selectPhase == 1 ? p1TeamIdx : p2TeamIdx];
            using (SolidBrush pb = new SolidBrush(Color.FromArgb(0, 12, 28)))
            {
                g.FillRectangle(pb, 80, 335, 800, 175);
                g.DrawRectangle(Pens.Yellow, 80, 335, 800, 175);
            }
            DrawTextCentered(g, "ELENCO OFICIAL EXTRAÍDO DA ROM: " + focus.FullName, 480, 345, 13f, Brushes.Yellow);

            for (int i = 0; i < focus.Roster.Count; i++)
            {
                PlayerData p = focus.Roster[i];
                int px = 110 + (i % 4) * 195;
                int py = 382 + (i / 4) * 55;
                using (Font f = new Font("Consolas", 10.5f, FontStyle.Bold))
                {
                    g.DrawString(string.Format("#{0:00} {1}", p.Number, p.Name), f, Brushes.White, px, py);
                    g.DrawString(string.Format("SP:{0} RE:{1} SV:{2} BL:{3}", p.SP, p.RE, p.SV, p.BL), f, Brushes.Cyan, px, py + 18);
                }
            }
        }

        private void DrawMatch(Graphics g)
        {
            g.Clear(Color.FromArgb(0, 20, 40));

            // Mundo da quadra com câmera horizontal
            GraphicsState st = g.Save();
            g.TranslateTransform(-camX, 0);

            // Placas V-SYSTEM
            using (SolidBrush adB = new SolidBrush(Color.FromArgb(180, 0, 0)))
            {
                g.FillRectangle(adB, 40, 168, WORLD_W - 80, 34);
                g.DrawRectangle(Pens.White, 40, 168, WORLD_W - 80, 34);
            }
            for (int bx = 120; bx < (int)WORLD_W - 120; bx += 280)
            {
                DrawTextCentered(g, "V-SYSTEM • SUPER VOLLEY BALL", bx + 100, 176, 11f, Brushes.White);
            }

            // Piso verde externo e quadra de madeira
            using (SolidBrush outB = new SolidBrush(Color.FromArgb(0, 120, 96)))
            {
                g.FillRectangle(outB, 0, 202, WORLD_W, 350);
            }
            using (SolidBrush woodB = new SolidBrush(Color.FromArgb(208, 112, 42)))
            using (Pen linePen = new Pen(Color.White, 3f))
            {
                PointF[] pts = new PointF[] {
                    new PointF(COURT_LEFT + 35, 375),
                    new PointF(COURT_RIGHT - 35, 375),
                    new PointF(COURT_RIGHT + 25, 472),
                    new PointF(COURT_LEFT - 25, 472)
                };
                g.FillPolygon(woodB, pts);
                g.DrawPolygon(linePen, pts);
                g.DrawLine(linePen, NET_X - 175, 375, NET_X - 195, 472);
                g.DrawLine(linePen, NET_X + 175, 375, NET_X + 195, 472);
                g.DrawLine(linePen, NET_X, 375, NET_X, 472);
            }

            // Sombra do alvo da bola
            if (rallyState == "IN_PLAY")
            {
                g.DrawEllipse(Pens.Yellow, ballTargetX - 14, FLOOR_Y, 28, 10);
            }

            // Jogadores das duas seleções
            for (int s = 0; s < 2; s++)
            {
                TeamInstance ti = matchTeams[s];
                int act = GetClosestPlayer(ti, ballTargetX);
                for (int i = 0; i < 6; i++)
                {
                    CourtPlayer p = ti.Players[i];
                    float px = p.X;
                    float py = p.Y + p.Z;
                    g.FillEllipse(Brushes.Black, px - 14, FLOOR_Y + p.Z - 2, 28, 8);
                    if (!ti.IsCPU && i == act)
                    {
                        g.DrawEllipse(Pens.Cyan, px - 18, FLOOR_Y + p.Z - 4, 36, 12);
                    }
                    using (SolidBrush jb = new SolidBrush(ti.Def.JerseyPrimary))
                    using (SolidBrush sb = new SolidBrush(ti.Def.JerseySecondary))
                    using (SolidBrush sk = new SolidBrush(ti.Def.SkinColor))
                    {
                        g.FillRectangle(sb, px - 9, py - 24, 18, 12);
                        g.FillRectangle(jb, px - 11, py - 50, 22, 26);
                        g.FillRectangle(sk, px - 8, py - 66, 16, 15);
                    }
                    DrawTextCentered(g, p.Data.Number.ToString(), px, py - 44, 9f, Brushes.Yellow);
                    DrawTextCentered(g, p.Data.Name, px, FLOOR_Y + p.Z + 6, 8.5f, Brushes.White);
                }
            }

            // Rede central
            g.FillRectangle(Brushes.LightGray, NET_X - 3, NET_TOP_Y, 6, FLOOR_Y - NET_TOP_Y + 12);
            g.FillRectangle(Brushes.White, NET_X - 5, NET_TOP_Y, 10, 8);

            // Bola
            foreach (PointF tp in ballTrail)
            {
                g.FillEllipse(ballSuper ? Brushes.OrangeRed : Brushes.Silver, tp.X - 6, tp.Y - 6, 12, 12);
            }
            g.FillEllipse(ballSuper ? Brushes.Red : Brushes.White, ballX - 12, ballY - 12, 24, 24);
            g.DrawEllipse(Pens.Black, ballX - 12, ballY - 12, 24, 24);

            g.Restore(st);

            // Placar HUD Superior
            using (SolidBrush hudB = new SolidBrush(Color.FromArgb(220, 0, 12, 28)))
            {
                g.FillRectangle(hudB, 140, 8, 680, 58);
                g.DrawRectangle(Pens.RoyalBlue, 140, 8, 680, 58);
            }
            DrawTextCentered(g, matchTeams[0].Def.Code + " (SETS: " + matchTeams[0].SetsWon + ")", 250, 24, 15f, Brushes.Cyan);
            DrawTextCentered(g, string.Format("{0:00}  -  {1:00}", matchTeams[0].Points, matchTeams[1].Points), 480, 18, 24f, Brushes.Yellow);
            DrawTextCentered(g, matchTeams[1].Def.Code + " (SETS: " + matchTeams[1].SetsWon + ")", 710, 24, 15f, Brushes.LightCoral);

            if (callTimer > 0)
            {
                using (SolidBrush cb = new SolidBrush(Color.FromArgb(210, 0, 0, 0)))
                {
                    g.FillRectangle(cb, 300, 74, 360, 48);
                    g.DrawRectangle(Pens.Yellow, 300, 74, 360, 48);
                }
                DrawTextCentered(g, callText, 480, 78, 16f, Brushes.Yellow);
                DrawTextCentered(g, callSubText, 480, 102, 10f, Brushes.Cyan);
            }

            // Rodapé de controles
            using (SolidBrush fb = new SolidBrush(Color.FromArgb(235, 0, 10, 24)))
            {
                g.FillRectangle(fb, 0, 504, 960, 38);
            }
            DrawTextCentered(g, "CONTROLES: Setas/WASD = Mover | Z/Espaço = Manchete/Levantar/Saque | X = Pular/Cortar/Bloquear | C = Super (Makyuu/Lightning)", 480, 514, 9.5f, Brushes.White);
        }

        private void DrawSetOver(Graphics g)
        {
            g.Clear(Color.FromArgb(0, 24, 48));
            DrawTextCentered(g, "FIM DO SET " + currentSet, 480, 80, 26f, Brushes.Yellow);
            DrawTextCentered(g, string.Format("{0}  {1}  x  {2}  {3}", matchTeams[0].Def.Code, matchTeams[0].SetsWon, matchTeams[1].SetsWon, matchTeams[1].Def.Code), 480, 145, 30f, Brushes.White);

            bool won = matchTeams[0].Points > matchTeams[1].Points;
            string quote = won ? "COACH: \"HEY! GREAT JOB. LET'S GO FOR THE GOLD!\"" : "COACH: \"SORRY-COACH. WE'LL TRY HARDER NEXT TIME!\"";
            DrawTextCentered(g, quote, 480, 260, 15f, Brushes.LightGreen);
            DrawTextCentered(g, "PRESSIONE ENTER / Z PARA CONTINUAR", 480, 380, 16f, Brushes.Yellow);
        }

        private void DrawCredits(Graphics g)
        {
            g.Clear(Color.FromArgb(0, 16, 32));
            DrawTextCentered(g, "SUPER VOLLEY BALL - STAFF CREDITS (ROM 0x14DA0)", 480, 70, 22f, Brushes.Yellow);
            DrawTextCentered(g, "PROGRAMMER: MASAHIKO TSUKADA (MICRONICS)", 480, 150, 14f, Brushes.White);
            DrawTextCentered(g, "DESIGNERS: SHINSUKE NAKAMURA • SHOUKO ISHIMOTO", 480, 200, 14f, Brushes.White);
            DrawTextCentered(g, "MUSIC COMPOSERS: KENJI OKUDA • NAOKI ITAMURA", 480, 250, 14f, Brushes.White);
            DrawTextCentered(g, "REVERSE ENGINEERING: REA (morluto/rea) & VDP EXTRACTOR", 480, 300, 14f, Brushes.Cyan);
            DrawTextCentered(g, "PRESSIONE ENTER PARA VOLTAR AO MENU", 480, 410, 16f, Brushes.Yellow);
        }

        [STAThread]
        public static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }
}
