// ============================================================================
// SUPER VOLLEY BALL (SEGA MEGA DRIVE / GENESIS, 1991) - PC EDITION ENGINE
// Engenharia Reversa da ROM GM T-30016-00 (Video System / Micronics)
// ============================================================================

(function () {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const W = 960;
  const H = 540;
  canvas.width = W;
  canvas.height = H;

  const romData = window.SUPER_VOLLEY_ROM_DATA || { teams: [], palettes: [], sfx_catalog: [], fm_instruments: [] };
  const teams = romData.teams || [];

  // Opções globais (espelhando 0x13A40 - 0x13AE0 da ROM)
  const options = {
    ballSpeed: "NORMAL", // SLOW, NORMAL, FAST
    beginningPoints: 0,  // 0, 5, 10, 14
    setsToWin: 2,        // 1, 2, 3
    nameIndication: true,
    crtEffect: true,
    unlockedSecret: false,
    soundTestIdx: 0
  };

  // Estados de tela
  // TITLE, MAIN_MENU, SUB_MENU_1P, TEAM_SELECT, PASSWORD, WORLD_LEAGUE_LADDER,
  // MATCH, SET_SUMMARY, TEAM_EDIT, OPTIONS, STAFF_ROLL
  let gameState = "TITLE";
  let menuCursor = 0;
  let subMenuCursor = 0;
  let gameMode = "1P_NORMAL"; // 1P_NORMAL, 1P_LEAGUE, 2P_NORMAL, WATCH
  let p1TeamIdx = 2; // Default BRAZIL (2) ou USA (0)
  let p2TeamIdx = 0;
  let selectPhase = 1; // 1 = escolhendo P1, 2 = escolhendo P2

  // World League state
  let leagueStage = 0; // 0..7
  let leagueOpponents = [];
  let leaguePassword = "SVB91-BRA-01";
  let passwordInput = "";

  // Team Edit state
  let editTeamIdx = 2;
  let editPlayerIdx = 0;
  let editFieldIdx = 0; // 0=Palette, 1=Player Num, 2=SP, 3=RE, 4=SV, 5=BL

  // Substituição em quadra (Team Member Change - 0x13B00)
  let subModalOpen = false;
  let subCursorCourt = 0;
  let subCursorBench = 6;
  let subSelectingBench = false;

  // Input tracking
  const keys = {};
  const justPressed = {};

  window.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].includes(e.code)) {
      e.preventDefault();
    }
    if (!keys[e.code]) {
      justPressed[e.code] = true;
    }
    keys[e.code] = true;

    // Captura de texto no modo Password
    if (gameState === "PASSWORD") {
      if (e.key === "Backspace") {
        passwordInput = passwordInput.slice(0, -1);
        window.ymSynth.playSFX("menu_move");
      } else if (e.key === "Enter") {
        submitPassword();
      } else if (/^[a-zA-Z0-9\-]$/.test(e.key) && passwordInput.length < 14) {
        passwordInput += e.key.toUpperCase();
        window.ymSynth.playSFX("menu_move");
      }
    }
  });

  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });

  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p) continue;
      const prefix = i === 0 ? "GP1_" : "GP2_";
      const mapBtn = (idx, name) => {
        const down = p.buttons[idx] && p.buttons[idx].pressed;
        if (down && !keys[prefix + name]) justPressed[prefix + name] = true;
        keys[prefix + name] = down;
      };
      mapBtn(0, "A");
      mapBtn(1, "B");
      mapBtn(2, "C");
      mapBtn(9, "START");
      const axX = p.axes[0] || 0;
      const axY = p.axes[1] || 0;
      keys[prefix + "LEFT"] = axX < -0.4 || (p.buttons[14] && p.buttons[14].pressed);
      keys[prefix + "RIGHT"] = axX > 0.4 || (p.buttons[15] && p.buttons[15].pressed);
      keys[prefix + "UP"] = axY < -0.4 || (p.buttons[12] && p.buttons[12].pressed);
      keys[prefix + "DOWN"] = axY > 0.4 || (p.buttons[13] && p.buttons[13].pressed);
    }
  }

  function isJustPressed(action, player = 1) {
    if (player === 1) {
      if (action === "UP") return justPressed["ArrowUp"] || justPressed["KeyW"] || justPressed["GP1_UP"];
      if (action === "DOWN") return justPressed["ArrowDown"] || justPressed["KeyS"] || justPressed["GP1_DOWN"];
      if (action === "LEFT") return justPressed["ArrowLeft"] || justPressed["KeyA"] || justPressed["GP1_LEFT"];
      if (action === "RIGHT") return justPressed["ArrowRight"] || justPressed["KeyD"] || justPressed["GP1_RIGHT"];
      if (action === "A") return justPressed["KeyZ"] || justPressed["KeyJ"] || justPressed["Space"] || justPressed["GP1_A"];
      if (action === "B") return justPressed["KeyX"] || justPressed["KeyK"] || justPressed["GP1_B"];
      if (action === "C") return justPressed["KeyC"] || justPressed["KeyL"] || justPressed["GP1_C"];
      if (action === "START") return justPressed["Enter"] || justPressed["GP1_START"];
      if (action === "SUB") return justPressed["Tab"] || justPressed["KeyT"];
    } else {
      if (action === "UP") return justPressed["ArrowUp"] || justPressed["KeyI"] || justPressed["Numpad8"] || justPressed["GP2_UP"];
      if (action === "DOWN") return justPressed["ArrowDown"] || justPressed["KeyK"] || justPressed["Numpad5"] || justPressed["GP2_DOWN"];
      if (action === "LEFT") return justPressed["ArrowLeft"] || justPressed["KeyJ"] || justPressed["Numpad4"] || justPressed["GP2_LEFT"];
      if (action === "RIGHT") return justPressed["ArrowRight"] || justPressed["KeyL"] || justPressed["Numpad6"] || justPressed["GP2_RIGHT"];
      if (action === "A") return justPressed["Numpad1"] || justPressed["Comma"] || justPressed["GP2_A"];
      if (action === "B") return justPressed["Numpad2"] || justPressed["Period"] || justPressed["GP2_B"];
      if (action === "C") return justPressed["Numpad3"] || justPressed["Slash"] || justPressed["GP2_C"];
    }
    return false;
  }

  function isHeld(action, player = 1) {
    if (player === 1) {
      const twoP = gameMode === "2P_NORMAL";
      if (action === "UP") return (twoP ? false : keys["ArrowUp"]) || keys["KeyW"] || keys["GP1_UP"];
      if (action === "DOWN") return (twoP ? false : keys["ArrowDown"]) || keys["KeyS"] || keys["GP1_DOWN"];
      if (action === "LEFT") return (twoP ? false : keys["ArrowLeft"]) || keys["KeyA"] || keys["GP1_LEFT"];
      if (action === "RIGHT") return (twoP ? false : keys["ArrowRight"]) || keys["KeyD"] || keys["GP1_RIGHT"];
      if (action === "A") return keys["KeyZ"] || keys["KeyJ"] || keys["Space"] || keys["GP1_A"];
      if (action === "B") return keys["KeyX"] || keys["KeyK"] || keys["GP1_B"];
      if (action === "C") return keys["KeyC"] || keys["KeyL"] || keys["GP1_C"];
    } else {
      if (action === "UP") return keys["ArrowUp"] || keys["Numpad8"] || keys["GP2_UP"];
      if (action === "DOWN") return keys["ArrowDown"] || keys["Numpad5"] || keys["GP2_DOWN"];
      if (action === "LEFT") return keys["ArrowLeft"] || keys["Numpad4"] || keys["GP2_LEFT"];
      if (action === "RIGHT") return keys["ArrowRight"] || keys["Numpad6"] || keys["GP2_RIGHT"];
      if (action === "A") return keys["Numpad1"] || keys["Comma"] || keys["GP2_A"];
      if (action === "B") return keys["Numpad2"] || keys["Period"] || keys["GP2_B"];
      if (action === "C") return keys["Numpad3"] || keys["Slash"] || keys["GP2_C"];
    }
    return false;
  }

  // ============================================================================
  // GEOMETRIA DA QUADRA E ESTRUTURAS DE PARTIDA (SIDE-SCROLLING 2D c/ PROFUNDIDADE)
  // ============================================================================
  // A quadra inteira tem 1400px de largura virtual; câmera acompanha a bola (0..440)
  const WORLD_W = 1400;
  const NET_X = 700;
  const COURT_LEFT_X = 160;
  const COURT_RIGHT_X = 1240;
  const FLOOR_Y = 445;      // Linha base de referência no chão
  const NET_TOP_Y = 290;    // Topo da antena/rede

  let camX = 220;
  let frameCount = 0;
  let crowdCheerTimer = 0;
  let screenShake = 0;

  let match = null;

  function createTeamInstance(teamIdx, side, isCPU) {
    const base = teams[teamIdx] || teams[0];
    // Copia os jogadores para permitir rotação e substituições
    const fullRoster = base.roster.map((p) => Object.assign({}, p));
    while (fullRoster.length < 6) {
      fullRoster.push(Object.assign({}, fullRoster[0]));
    }

    // Verifica se as duas equipes têm cores parecidas -> usa paleta alternativa da ROM
    let primaryColor = base.jersey_primary;
    let secondaryColor = base.jersey_secondary;
    if (side === 1 && p1TeamIdx === p2TeamIdx) {
      primaryColor = base.alt_jersey_primary || "#FCFC00";
      secondaryColor = base.alt_jersey_secondary || "#0000FC";
    }

    const courtPlayers = [];
    for (let slot = 0; slot < 6; slot++) {
      courtPlayers.push(createPlayerEntity(fullRoster[slot], side, slot));
    }

    return {
      teamIdx,
      code: base.code,
      name: base.name,
      side, // 0 = Esquerda (P1), 1 = Direita (P2/CPU)
      isCPU,
      primaryColor,
      secondaryColor,
      skinColor: base.skin_color || "#FCB490",
      fullRoster,
      courtPlayers, // 0=Server/BackRight, 1=BackMid, 2=Setter/FrontMid, 3=FrontLeft, 4=MiddleBlocker, 5=FrontRight
      setsWon: 0,
      points: options.beginningPoints,
      touches: 0,
      lastTouchedBy: -1,
      setPlan: "OPEN", // OPEN, QUICK, BACK, DUMP
      superUsedThisSet: false,
      stats: {
        serves: 0,
        serveAces: 0,
        spikes: 0,
        spikeAces: 0,
        blocks: 0,
        blockAces: 0
      }
    };
  }

  function getHomePosition(side, slot) {
    // Slots 0..5:
    // 0: Sacador / Defesa Fundo (Back-Right)
    // 1: Líbero / Defesa Centro-Fundo (Back-Center)
    // 2: Levantador (Setter - perto da rede)
    // 3: Atacante Ponta (Front-Wing)
    // 4: Central / Bloqueador (Front-Center)
    // 5: Atacante Oposto (Front-Attack)
    if (side === 0) {
      const homes = [
        { x: 230, z: 12 },  // 0: Server / Back
        { x: 350, z: -14 }, // 1: Back Center
        { x: 595, z: -18 }, // 2: Setter
        { x: 470, z: 18 },  // 3: Wing Spiker
        { x: 635, z: 0 },   // 4: Middle Blocker
        { x: 540, z: 15 }   // 5: Front Attacker
      ];
      return homes[slot];
    } else {
      const homes = [
        { x: 1170, z: 12 }, // 0: Server / Back
        { x: 1050, z: -14 },// 1: Back Center
        { x: 805, z: -18 }, // 2: Setter
        { x: 930, z: 18 },  // 3: Wing Spiker
        { x: 765, z: 0 },   // 4: Middle Blocker
        { x: 860, z: 15 }   // 5: Front Attacker
      ];
      return homes[slot];
    }
  }

  function createPlayerEntity(pdata, side, slot) {
    const home = getHomePosition(side, slot);
    return {
      data: pdata,
      side,
      slot,
      x: home.x,
      y: FLOOR_Y,
      z: home.z,
      vx: 0,
      vy: 0,
      homeX: home.x,
      homeZ: home.z,
      state: "IDLE", // IDLE, RUN, JUMP, SPIKE, BLOCK, DIVE, TOSS, SERVE_WAIT, SERVE_TOSS
      animTimer: 0,
      diveDir: 0,
      cooldown: 0,
      facing: side === 0 ? 1 : -1
    };
  }

  function rotateTeam(team) {
    // Rotação oficial do voleibol no side-out
    const firstData = team.courtPlayers[0].data;
    for (let i = 0; i < 5; i++) {
      team.courtPlayers[i].data = team.courtPlayers[i + 1].data;
    }
    team.courtPlayers[5].data = firstData;
    resetTeamPositions(team);
  }

  function resetTeamPositions(team, servingSide) {
    for (let i = 0; i < 6; i++) {
      const p = team.courtPlayers[i];
      const home = getHomePosition(team.side, i);
      p.homeX = home.x;
      p.homeZ = home.z;
      p.x = home.x;
      p.y = FLOOR_Y;
      p.z = home.z;
      p.vx = 0;
      p.vy = 0;
      p.state = "IDLE";
      p.animTimer = 0;
      p.cooldown = 0;
      p.facing = team.side === 0 ? 1 : -1;
    }
    if (servingSide === team.side) {
      const srv = team.courtPlayers[0];
      srv.x = team.side === 0 ? COURT_LEFT_X - 32 : COURT_RIGHT_X + 32;
      srv.state = "SERVE_WAIT";
    }
  }

  function startMatch(t1Idx, t2Idx, mode) {
    gameMode = mode;
    const t1CPU = mode === "WATCH";
    const t2CPU = mode !== "2P_NORMAL";

    const t0 = createTeamInstance(t1Idx, 0, t1CPU);
    const t1 = createTeamInstance(t2Idx, 1, t2CPU);

    match = {
      teams: [t0, t1],
      servingSide: 0,
      rallyState: "PRE_SERVE", // PRE_SERVE, SERVE_TOSS, IN_PLAY, POINT_SCORED, SET_OVER, MATCH_OVER
      stateTimer: 90,
      callText: "SERVICE!",
      callSubText: "",
      callTimer: 75,
      refereeSignal: "SERVICE", // SERVICE, LEFT_POINT, RIGHT_POINT, IN, OUT
      lineJudgeState: "NEUTRAL", // NEUTRAL, IN, OUT
      currentSet: 1,
      setHistory: [],
      lastHitType: "SERVE", // SERVE, RECEIVE, TOSS, SPIKE, BLOCK
      lastHitterSide: 0,
      ball: {
        x: COURT_LEFT_X - 28,
        y: FLOOR_Y - 52,
        vx: 0,
        vy: 0,
        spin: 0,
        isSuper: false,
        superType: null, // null, "MILKY_WAY", "LIGHTNING"
        trail: [],
        targetX: 900
      }
    };

    setupServe(0);
    gameState = "MATCH";
    window.ymSynth.startBGM("match");
    window.ymSynth.playSFX("FuePeeK");
    window.ymSynth.speakCall("Service!");
  }

  function setupServe(servingSide) {
    match.servingSide = servingSide;
    match.rallyState = "PRE_SERVE";
    match.stateTimer = 60;
    match.teams[0].touches = 0;
    match.teams[1].touches = 0;
    match.teams[0].lastTouchedBy = -1;
    match.teams[1].lastTouchedBy = -1;
    match.teams[0].setPlan = "OPEN";
    match.teams[1].setPlan = "OPEN";
    match.lineJudgeState = "NEUTRAL";
    match.refereeSignal = "SERVICE";

    resetTeamPositions(match.teams[0], servingSide);
    resetTeamPositions(match.teams[1], servingSide);

    const server = match.teams[servingSide].courtPlayers[0];
    match.ball.x = server.x + (servingSide === 0 ? 14 : -14);
    match.ball.y = FLOOR_Y - 52;
    match.ball.vx = 0;
    match.ball.vy = 0;
    match.ball.isSuper = false;
    match.ball.superType = null;
    match.ball.trail = [];
    match.ball.targetX = servingSide === 0 ? 960 : 440;
  }

  function getSpeedMult() {
    if (options.ballSpeed === "SLOW") return 0.82;
    if (options.ballSpeed === "FAST") return 1.18;
    return 1.0;
  }

  function computeBallLandingX(bx, by, vx, vy, gravity) {
    // Resolve y(t) = by + vy*t + 0.5*g*t^2 = FLOOR_Y - 12
    const targetY = FLOOR_Y - 12;
    const dy = targetY - by;
    const disc = vy * vy + 2 * gravity * dy;
    if (disc < 0) return bx + vx * 30;
    const t = (-vy + Math.sqrt(disc)) / gravity;
    return bx + vx * Math.max(1, t);
  }

  // ============================================================================
  // FÍSICA E MECÂNICAS DE JOGO (SAQUE, RECEPÇÃO, LEVANTAMENTO, CORTADA, BLOQUEIO)
  // ============================================================================
  function updateMatch() {
    if (subModalOpen) {
      updateSubstitutionModal();
      return;
    }

    if (isJustPressed("SUB", 1) && (match.rallyState === "PRE_SERVE" || match.rallyState === "POINT_SCORED")) {
      subModalOpen = true;
      subSelectingBench = false;
      window.ymSynth.playSFX("menu_select");
      return;
    }

    if (match.callTimer > 0) match.callTimer--;
    if (crowdCheerTimer > 0) crowdCheerTimer--;
    if (screenShake > 0) screenShake--;

    const spd = getSpeedMult();
    const GRAV = 0.36 * spd;
    const b = match.ball;

    // Câmera horizontal suave acompanhando a bola
    const desiredCamX = Math.max(0, Math.min(WORLD_W - W, b.x - W * 0.5));
    camX += (desiredCamX - camX) * 0.12;

    if (match.rallyState === "PRE_SERVE") {
      const srvTeam = match.teams[match.servingSide];
      const server = srvTeam.courtPlayers[0];
      const pNum = match.servingSide + 1;

      if (!srvTeam.isCPU) {
        // Movimentação do sacador na zona de saque
        if (isHeld("LEFT", pNum)) server.x -= 2.5;
        if (isHeld("RIGHT", pNum)) server.x += 2.5;
        if (match.servingSide === 0) {
          server.x = Math.max(70, Math.min(COURT_LEFT_X - 10, server.x));
        } else {
          server.x = Math.max(COURT_RIGHT_X + 10, Math.min(WORLD_W - 70, server.x));
        }
        b.x = server.x + (match.servingSide === 0 ? 14 : -14);
        b.y = server.y - 52;

        // Iniciar lançamento da bola (A = Normal, B = Saque Viagem, C = Super Saque Jornada nas Estrelas)
        if (isJustPressed("A", pNum) || isJustPressed("B", pNum) || isJustPressed("C", pNum)) {
          const isSuper = isJustPressed("C", pNum) && !srvTeam.superUsedThisSet;
          const isJump = isJustPressed("B", pNum);
          match.rallyState = "SERVE_TOSS";
          server.state = "SERVE_TOSS";
          b.vy = isSuper ? -13.5 * spd : isJump ? -9.5 * spd : -8.2 * spd;
          b.vx = isJump ? (match.servingSide === 0 ? 2.2 : -2.2) : 0;
          b.superType = isSuper ? "MILKY_WAY_PREP" : null;
          window.ymSynth.playSFX("ServeNew1");
        }
      } else {
        // CPU sacando
        match.stateTimer--;
        if (match.stateTimer <= 0) {
          match.rallyState = "SERVE_TOSS";
          server.state = "SERVE_TOSS";
          const useSuper = !srvTeam.superUsedThisSet && Math.random() < 0.18;
          b.vy = (useSuper ? -13.0 : -8.5) * spd;
          b.vx = match.servingSide === 0 ? 1.5 : -1.5;
          b.superType = useSuper ? "MILKY_WAY_PREP" : null;
          window.ymSynth.playSFX("ServeNew1");
        }
      }
      return;
    }

    if (match.rallyState === "SERVE_TOSS") {
      const srvTeam = match.teams[match.servingSide];
      const server = srvTeam.courtPlayers[0];
      const pNum = match.servingSide + 1;
      const dir = match.servingSide === 0 ? 1 : -1;

      b.x += b.vx;
      b.y += b.vy;
      b.vy += GRAV;

      if (!srvTeam.isCPU) {
        if (isHeld("LEFT", pNum)) server.x -= 2.8;
        if (isHeld("RIGHT", pNum)) server.x += 2.8;
        if (isJustPressed("B", pNum) && server.y >= FLOOR_Y) {
          server.vy = -8.8;
          server.vx = dir * 2.2;
          server.state = "JUMP";
        }
      } else {
        // CPU pula ou bate no saque quando a bola começa a descer
        if (b.vy > -1.0 && Math.abs(b.y - (server.y - 68)) < 36) {
          executeServeHit(srvTeam, server, b.superType === "MILKY_WAY_PREP", 0);
          return;
        }
      }

      // Jogador humano bate na bola no saque
      if (!srvTeam.isCPU && (isJustPressed("A", pNum) || isJustPressed("B", pNum) || isJustPressed("C", pNum))) {
        if (b.y < FLOOR_Y - 25) {
          let aim = 0;
          if (isHeld("LEFT", pNum)) aim = -1;
          if (isHeld("RIGHT", pNum)) aim = 1;
          const trigSuper = (b.superType === "MILKY_WAY_PREP" || isJustPressed("C", pNum)) && !srvTeam.superUsedThisSet;
          executeServeHit(srvTeam, server, trigSuper, aim);
          return;
        }
      }

      // Se deixou a bola cair no saque sem bater -> toca novamente
      if (b.y >= FLOOR_Y - 12) {
        setupServe(match.servingSide);
      }
      updateAllPlayers(GRAV);
      return;
    }

    if (match.rallyState === "IN_PLAY") {
      // Trail da bola
      b.trail.push({ x: b.x, y: b.y, super: b.isSuper });
      if (b.trail.length > 10) b.trail.shift();

      // Efeito zig-zag / meteoro do Super Saque "Jornada nas Estrelas" (Makyuu3)
      if (b.isSuper && b.superType === "MILKY_WAY") {
        if (b.vy > 0) {
          b.x += Math.sin(frameCount * 0.45) * 4.5;
        }
      }

      b.x += b.vx;
      b.y += b.vy;
      b.vy += GRAV;
      b.targetX = computeBallLandingX(b.x, b.y, b.vx, b.vy, GRAV);

      // Colisão com a fita/rede central (NET_X = 700, altura NET_TOP_Y..FLOOR_Y)
      if (Math.abs(b.x - NET_X) < 10 && b.y >= NET_TOP_Y - 8) {
        if (b.y < NET_TOP_Y + 14) {
          // Bateu na fita superior da rede! (Net cord)
          b.vx *= 0.45;
          b.vy = -Math.abs(b.vy) * 0.45 - 2.0;
          b.isSuper = false;
          window.ymSynth.playSFX("NewOneT");
        } else {
          // Bateu no meio da rede!
          b.vx = -b.vx * 0.35;
          b.x = b.x < NET_X ? NET_X - 11 : NET_X + 11;
          b.isSuper = false;
          window.ymSynth.playSFX("NewBlock2");
        }
      }

      // Atualiza jogadores e interações com a bola
      updateAllPlayers(GRAV);
      checkPlayerBallInteractions(GRAV, spd);

      // Verifica se a bola tocou o chão
      if (b.y >= FLOOR_Y - 10) {
        b.y = FLOOR_Y - 10;
        window.ymSynth.playSFX("Ball1");
        handleBallFloorContact();
      }
      return;
    }

    if (match.rallyState === "POINT_SCORED") {
      b.x += b.vx * 0.6;
      b.y += b.vy;
      b.vy += GRAV;
      if (b.y >= FLOOR_Y - 10) {
        b.y = FLOOR_Y - 10;
        b.vy = -Math.abs(b.vy) * 0.4;
        b.vx *= 0.7;
      }
      updateAllPlayers(GRAV);
      match.stateTimer--;
      if (match.stateTimer <= 0) {
        setupServe(match.servingSide);
        window.ymSynth.playSFX("FuePeeK");
      }
    }
  }

  function executeServeHit(srvTeam, server, isSuper, aim) {
    const spd = getSpeedMult();
    const dir = srvTeam.side === 0 ? 1 : -1;
    const svStat = server.data.sv || 5;
    const b = match.ball;

    srvTeam.stats.serves++;
    match.rallyState = "IN_PLAY";
    match.lastHitType = "SERVE";
    match.lastHitterSide = srvTeam.side;
    server.state = "SPIKE";
    server.animTimer = 20;

    if (isSuper) {
      // Super Saque "Jornada nas Estrelas" / Milky Way (Makyuu3)
      srvTeam.superUsedThisSet = true;
      b.isSuper = true;
      b.superType = "MILKY_WAY";
      b.vx = dir * (9.2 + aim * 1.4) * spd;
      b.vy = -15.5 * spd;
      match.callText = "MIRACLE SERVE!";
      match.callSubText = server.data.name + " #" + server.data.number;
      match.callTimer = 55;
      window.ymSynth.playSFX("Makyuu3");
    } else if (server.y < FLOOR_Y - 8) {
      // Jump Serve ("Saque Viagem")
      b.isSuper = false;
      b.superType = null;
      b.vx = dir * (11.2 + svStat * 0.35 + aim * dir * 1.5) * spd;
      b.vy = -6.8 * spd;
      match.callText = "JUMP SERVE!";
      match.callSubText = server.data.name;
      match.callTimer = 40;
      window.ymSynth.playSFX("SpikeOku1");
    } else {
      // Normal Overhand Serve
      b.isSuper = false;
      b.superType = null;
      b.vx = dir * (9.4 + svStat * 0.25 + aim * dir * 1.6) * spd;
      b.vy = -9.6 * spd;
      window.ymSynth.playSFX("ServeOK");
    }
  }

  function updateAllPlayers(GRAV) {
    const b = match.ball;
    const ballSide = b.x < NET_X ? 0 : 1;

    for (let s = 0; s < 2; s++) {
      const team = match.teams[s];
      const pNum = s + 1;
      const dir = s === 0 ? 1 : -1;

      // Escolha do jogador ativo controlado pelo humano quando a bola está no lado dele
      let activeIdx = getClosestCourtPlayerIndex(team, b.targetX);

      // Escolha de tática de levantamento (2º toque)
      if (!team.isCPU && ballSide === s && team.touches === 1) {
        if (isHeld("DOWN", pNum)) team.setPlan = "QUICK";
        else if ((s === 0 && isHeld("LEFT", pNum)) || (s === 1 && isHeld("RIGHT", pNum))) team.setPlan = "BACK";
        else if (isHeld("UP", pNum)) team.setPlan = "OPEN";
      }

      for (let i = 0; i < 6; i++) {
        const p = team.courtPlayers[i];
        if (p.cooldown > 0) p.cooldown--;
        if (p.animTimer > 0) p.animTimer--;

        // Física vertical do jogador (Pulo)
        if (p.y < FLOOR_Y || p.vy !== 0) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += GRAV * 1.15;
          if (p.y >= FLOOR_Y) {
            p.y = FLOOR_Y;
            p.vy = 0;
            p.vx = 0;
            if (p.state === "JUMP" || p.state === "SPIKE" || p.state === "BLOCK") {
              p.state = "IDLE";
            }
          }
        } else if (p.state === "DIVE") {
          // Deslize do peixinho (Diving Dig)
          p.x += p.vx;
          p.vx *= 0.88;
          if (p.animTimer <= 0) {
            p.state = "IDLE";
            p.vx = 0;
          }
        } else if (match.rallyState === "IN_PLAY") {
          const moveSpd = 3.2 + (p.data.re || 5) * 0.22;

          if (!team.isCPU && i === activeIdx && ballSide === s) {
            // Controle direto do jogador mais próximo da bola + assistência inteligente
            let moved = false;
            if (isHeld("LEFT", pNum)) {
              p.x -= moveSpd * 1.25;
              moved = true;
            }
            if (isHeld("RIGHT", pNum)) {
              p.x += moveSpd * 1.25;
              moved = true;
            }
            if (!moved) {
              // Assistência leve em direção ao ponto de queda da bola
              const dx = b.targetX - p.x;
              if (Math.abs(dx) > 12) p.x += Math.sign(dx) * moveSpd * 0.78;
            }

            // Peixinho (Diving Dig) se apertar A/B longe da bola baixa
            if ((isJustPressed("A", pNum) || isJustPressed("B", pNum)) && b.y > FLOOR_Y - 120 && Math.abs(b.x - p.x) > 42 && Math.abs(b.x - p.x) < 135) {
              p.state = "DIVE";
              p.animTimer = 22;
              p.vx = Math.sign(b.x - p.x) * 8.2;
            }

            // Pular para cortar ou bloquear (Botão B)
            if (isJustPressed("B", pNum) && p.y >= FLOOR_Y) {
              const jumpPower = 9.0 + (p.data.sp || 5) * 0.25;
              p.vy = -jumpPower;
              p.vx = isHeld("LEFT", pNum) ? -1.8 : isHeld("RIGHT", pNum) ? 1.8 : 0;
              p.state = "JUMP";
            }
          } else {
            // IA / Posicionamento coordenado dos outros jogadores da equipe
            updatePlayerAI(team, p, i, activeIdx, ballSide, moveSpd);
          }

          // Bloqueio Duplo Sincronizado pelo Jogador Humano quando a bola está no lado adversário
          if (!team.isCPU && ballSide !== s && (i === 4 || i === 5 || i === 2)) {
            if (isJustPressed("B", pNum) && p.y >= FLOOR_Y) {
              p.vy = -(8.6 + (p.data.bl || 5) * 0.25);
              p.state = "BLOCK";
              p.animTimer = 26;
            }
          }
        }

        // Limita os jogadores ao seu lado da rede
        if (s === 0) {
          p.x = Math.max(55, Math.min(NET_X - 20, p.x));
        } else {
          p.x = Math.max(NET_X + 20, Math.min(WORLD_W - 55, p.x));
        }
      }
    }
  }

  function updatePlayerAI(team, p, slot, activeIdx, ballSide, moveSpd) {
    const b = match.ball;
    const s = team.side;
    const dir = s === 0 ? 1 : -1;

    if (ballSide === s) {
      if (team.touches === 0) {
        // 1º toque (Recepção): o jogador mais próximo vai na bola, o Levantador (slot 2) corre para a rede
        if (slot === activeIdx) {
          const target = Math.max(s === 0 ? 90 : NET_X + 30, Math.min(s === 0 ? NET_X - 30 : WORLD_W - 90, b.targetX));
          const dx = target - p.x;
          if (Math.abs(dx) > 8) p.x += Math.sign(dx) * moveSpd;
          // Peixinho automático se a bola estiver longe e caindo
          if (b.vy > 2 && b.y > FLOOR_Y - 95 && Math.abs(b.x - p.x) > 48 && Math.abs(b.x - p.x) < 110 && p.state === "IDLE") {
            p.state = "DIVE";
            p.animTimer = 20;
            p.vx = Math.sign(b.x - p.x) * 7.8;
          }
        } else if (slot === 2) {
          // Levantador vai para a posição de levantamento
          const setterX = s === 0 ? NET_X - 95 : NET_X + 95;
          p.x += Math.sign(setterX - p.x) * Math.min(moveSpd, Math.abs(setterX - p.x));
        } else {
          p.x += Math.sign(p.homeX - p.x) * Math.min(moveSpd * 0.6, Math.abs(p.homeX - p.x));
        }
      } else if (team.touches === 1) {
        // 2º toque (Levantamento): Levantador (slot 2) ou mais próximo vai embaixo da bola
        const setterIdx = 2;
        if (slot === setterIdx || slot === activeIdx) {
          const dx = b.targetX - p.x;
          if (Math.abs(dx) > 6) p.x += Math.sign(dx) * moveSpd * 1.05;
        }
        // Se tática for QUICK (Bola de Tempo), o Central (slot 4) já corre e pula junto!
        if (team.setPlan === "QUICK" && slot === 4 && b.vy > 0 && b.y < FLOOR_Y - 60 && p.y >= FLOOR_Y) {
          p.vy = -(9.2 + (p.data.sp || 5) * 0.22);
          p.state = "JUMP";
        }
      } else if (team.touches === 2) {
        // 3º toque (Ataque / Cortada): atacante vai para o ponto de interceptação aérea e salta!
        if (slot === activeIdx || (team.setPlan === "QUICK" && slot === 4) || (team.setPlan === "BACK" && slot === 3)) {
          const interceptX = b.x + b.vx * 10 - dir * 14;
          const dx = interceptX - p.x;
          if (Math.abs(dx) > 8) p.x += Math.sign(dx) * moveSpd * 1.1;

          // Salta no timing exato para cortar no ponto mais alto!
          if (p.y >= FLOOR_Y && b.y < FLOOR_Y - 75 && Math.abs(b.x - p.x) < 55 && (b.vy > -2.5 || team.setPlan === "QUICK")) {
            if (team.isCPU || slot !== activeIdx) {
              p.vy = -(9.2 + (p.data.sp || 5) * 0.25);
              p.vx = dir * 1.4;
              p.state = "JUMP";
            }
          }
        }
      }
    } else {
      // Bola está no lado adversário: preparar defesa e bloqueio duplo na rede!
      const oppTeam = match.teams[1 - s];
      if (slot === 4 || slot === 5) {
        // Jogadores da rede acompanham o atacante adversário
        const blockX = s === 0 ? NET_X - 28 - (slot === 5 ? 18 : 0) : NET_X + 28 + (slot === 5 ? 18 : 0);
        p.x += Math.sign(blockX - p.x) * Math.min(moveSpd * 0.85, Math.abs(blockX - p.x));

        // Bloqueio automático da CPU (ou parceiro de IA) quando o adversário salta para cortar perto da rede
        if (team.isCPU && oppTeam.touches >= 2 && b.y < FLOOR_Y - 85 && Math.abs(b.x - NET_X) < 180 && p.y >= FLOOR_Y) {
          if (Math.random() < 0.14) {
            p.vy = -(8.5 + (p.data.bl || 5) * 0.25);
            p.state = "BLOCK";
            p.animTimer = 26;
          }
        }
      } else {
        // Defensores voltam para a posição base
        p.x += Math.sign(p.homeX - p.x) * Math.min(moveSpd * 0.7, Math.abs(p.homeX - p.x));
      }
    }
  }

  function getClosestCourtPlayerIndex(team, targetX) {
    let bestIdx = 0;
    let bestDist = 999999;
    for (let i = 0; i < 6; i++) {
      const p = team.courtPlayers[i];
      const d = Math.abs(p.x - targetX);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function checkPlayerBallInteractions(GRAV, spd) {
    const b = match.ball;
    const ballSide = b.x < NET_X ? 0 : 1;

    // 1. Verifica BLOQUEIO NA REDE (jogadores do lado oposto ao último toque saltando perto da rede)
    for (let s = 0; s < 2; s++) {
      const team = match.teams[s];
      if (match.lastHitterSide !== s && Math.abs(b.x - NET_X) < 52 && b.y < NET_TOP_Y + 45) {
        for (let i = 0; i < 6; i++) {
          const p = team.courtPlayers[i];
          if (p.y < FLOOR_Y - 22 && p.cooldown === 0 && Math.abs(p.x - b.x) < 42 && Math.abs((p.y - 68) - b.y) < 42) {
            p.cooldown = 25;
            p.state = "BLOCK";
            p.animTimer = 18;
            team.stats.blocks++;

            const blStat = p.data.bl || 5;
            const blockRoll = Math.random() * 10 + blStat;
            const dir = s === 0 ? 1 : -1;

            if (blockRoll > 10.5 && !b.isSuper) {
              // Roof Block! Bola volta cravada na quadra adversária
              b.vx = dir * (6.5 + blStat * 0.4) * spd;
              b.vy = 4.2 * spd;
              b.isSuper = false;
              match.lastHitType = "BLOCK";
              match.lastHitterSide = s;
              match.callText = "SHUTOUT BLOCK!";
              match.callSubText = p.data.name + " (BL " + blStat + ")";
              match.callTimer = 45;
              window.ymSynth.playSFX("NewBlock2");
            } else {
              // One-Touch! Amortecida para defesa no próprio lado
              b.vx = -dir * (3.2 + Math.random() * 2.0) * spd;
              b.vy = -8.8 * spd;
              b.isSuper = false;
              match.callText = "ONE TOUCH!";
              match.callSubText = p.data.name;
              match.callTimer = 35;
              window.ymSynth.playSFX("NewOneT");
            }
            return;
          }
        }
      }
    }

    // 2. Verifica RECEPÇÃO, LEVANTAMENTO E CORTADA no lado onde a bola está
    const team = match.teams[ballSide];
    const pNum = ballSide + 1;
    const dir = ballSide === 0 ? 1 : -1;

    for (let i = 0; i < 6; i++) {
      const p = team.courtPlayers[i];
      if (p.cooldown > 0) continue;

      const hitY = p.y < FLOOR_Y ? p.y - 64 : p.state === "DIVE" ? FLOOR_Y - 18 : FLOOR_Y - 44;
      const reachX = p.state === "DIVE" ? 54 : 38;
      const reachY = p.y < FLOOR_Y ? 44 : 36;

      if (Math.abs(b.x - p.x) <= reachX && Math.abs(b.y - hitY) <= reachY) {
        // Se o jogador está no ar -> CORTADA (Spike) ou LARGADINHA (Dink) ou LEVANTAMENTO EM SALTO
        if (p.y < FLOOR_Y - 12 && team.touches >= 1) {
          executeAerialAttack(team, p, i, pNum, dir, spd);
          return;
        }

        // Toque no chão / manchete / levantamento
        if (b.vy > -2.0) {
          p.cooldown = 22;
          team.touches++;
          team.lastTouchedBy = i;

          if (team.touches === 1) {
            // 1º Toque: RECEPÇÃO (Manchete) -> manda para o Levantador (Setter perto da rede)
            p.state = p.state === "DIVE" ? "DIVE" : "RECEIVE";
            p.animTimer = 18;
            const setterTargetX = ballSide === 0 ? NET_X - 95 : NET_X + 95;
            const flightFrames = 56;
            b.vx = (setterTargetX - b.x) / flightFrames;
            b.vy = -10.2 * spd;
            b.isSuper = false;
            b.superType = null;
            match.lastHitType = "RECEIVE";
            match.lastHitterSide = ballSide;
            window.ymSynth.playSFX("NewRecv1");
            return;
          } else if (team.touches === 2) {
            // 2º Toque: LEVANTAMENTO (Toss) -> Normal (Open), Quick (Bola de Tempo), Back (Fundo) ou Largadinha de 2ª!
            if (team.isCPU) {
              const r = Math.random();
              team.setPlan = r < 0.28 ? "QUICK" : r < 0.52 ? "BACK" : "OPEN";
            } else {
              if (isHeld("DOWN", pNum)) team.setPlan = "QUICK";
              else if ((ballSide === 0 && isHeld("LEFT", pNum)) || (ballSide === 1 && isHeld("RIGHT", pNum))) team.setPlan = "BACK";
              else team.setPlan = "OPEN";
            }

            p.state = "TOSS";
            p.animTimer = 20;
            match.lastHitType = "TOSS";
            match.lastHitterSide = ballSide;

            if (team.setPlan === "QUICK") {
              // Bola de Tempo (rápida e baixa perto da rede para o Central slot 4)
              const targetX = ballSide === 0 ? NET_X - 55 : NET_X + 55;
              const frames = 34;
              b.vx = (targetX - b.x) / frames;
              b.vy = -7.6 * spd;
              match.callText = "QUICK SET!";
              match.callSubText = p.data.name;
              match.callTimer = 35;
              const mb = team.courtPlayers[4];
              if (mb.y >= FLOOR_Y) {
                mb.vy = -(9.4 + (mb.data.sp || 5) * 0.22);
                mb.state = "JUMP";
              }
            } else if (team.setPlan === "BACK") {
              // Levantamento para ataque de fundo de quadra (slot 3)
              const targetX = ballSide === 0 ? NET_X - 210 : NET_X + 210;
              const frames = 54;
              b.vx = (targetX - b.x) / frames;
              b.vy = -10.8 * spd;
              match.callText = "BACK ROW SET!";
              match.callSubText = p.data.name;
              match.callTimer = 35;
            } else {
              // Levantamento Alto Aberto (Open Set)
              const targetX = ballSide === 0 ? NET_X - 115 : NET_X + 115;
              const frames = 58;
              b.vx = (targetX - b.x) / frames;
              b.vy = -11.4 * spd;
            }
            window.ymSynth.playSFX("Toss1");
            return;
          } else {
            // 3º Toque no chão (Bola de Segurança / Manchete para o outro lado)
            p.state = "RECEIVE";
            p.animTimer = 18;
            const oppTargetX = ballSide === 0 ? NET_X + 280 : NET_X - 280;
            const frames = 62;
            b.vx = (oppTargetX - b.x) / frames;
            b.vy = -11.2 * spd;
            b.isSuper = false;
            match.lastHitType = "RECEIVE";
            match.lastHitterSide = ballSide;
            team.touches = 0;
            window.ymSynth.playSFX("NewRecv1");
            return;
          }
        }
      }
    }
  }

  function executeAerialAttack(team, p, slot, pNum, dir, spd) {
    const b = match.ball;
    p.cooldown = 26;
    p.state = "SPIKE";
    p.animTimer = 20;
    team.touches = 0;
    team.stats.spikes++;
    match.lastHitType = "SPIKE";
    match.lastHitterSide = team.side;

    const spStat = p.data.sp || 5;
    const isHuman = !team.isCPU;

    // Largadinha (Dink / Lob) se segurar UP + A
    const isDink = isHuman ? (isHeld("UP", pNum) && isHeld("A", pNum)) : (Math.random() < 0.16);
    // Super Cortada Relâmpago (Lightning Spike) se segurar DOWN + C (1x por set)
    const isSuperSpike = !team.superUsedThisSet && (
      isHuman ? (isHeld("C", pNum) || (isHeld("DOWN", pNum) && isHeld("B", pNum))) : (spStat >= 7 && Math.random() < 0.22)
    );

    if (isDink) {
      b.isSuper = false;
      b.superType = null;
      b.vx = dir * (4.6 + Math.random() * 1.4) * spd;
      b.vy = -7.2 * spd;
      match.callText = "DINK SHOT!";
      match.callSubText = p.data.name + " #" + p.data.number;
      match.callTimer = 40;
      window.ymSynth.playSFX("Toss1");
    } else if (isSuperSpike) {
      team.superUsedThisSet = true;
      b.isSuper = true;
      b.superType = "LIGHTNING";
      b.vx = dir * (14.5 + spStat * 0.45) * spd;
      b.vy = 5.2 * spd;
      screenShake = 12;
      match.callText = "LIGHTNING SPIKE!";
      match.callSubText = p.data.name + " (SP " + spStat + ")";
      match.callTimer = 55;
      window.ymSynth.playSFX("Makyuu3");
      window.ymSynth.playSFX("SpikeOK4");
    } else {
      // Cortada Normal (Power Spike) direcionável (Fundo / Diagonal / Cravada)
      let aimFactor = 1.0;
      if (isHuman) {
        if ((team.side === 0 && isHeld("RIGHT", pNum)) || (team.side === 1 && isHeld("LEFT", pNum))) aimFactor = 1.22;
        if ((team.side === 0 && isHeld("LEFT", pNum)) || (team.side === 1 && isHeld("RIGHT", pNum))) aimFactor = 0.78;
      } else {
        aimFactor = 0.82 + Math.random() * 0.38;
      }
      b.isSuper = false;
      b.superType = null;
      b.vx = dir * (10.2 + spStat * 0.42) * aimFactor * spd;
      b.vy = (2.8 + (8 - spStat) * 0.25) * spd;
      screenShake = 6;
      match.callText = team.setPlan === "QUICK" ? "QUICK ATTACK!" : team.setPlan === "BACK" ? "BACK ATTACK!" : "POWER SPIKE!";
      match.callSubText = p.data.name + " #" + p.data.number;
      match.callTimer = 42;
      window.ymSynth.playSFX("SpikeOku1");
    }
  }

  function handleBallFloorContact() {
    const b = match.ball;
    match.rallyState = "POINT_SCORED";
    match.stateTimer = 95;
    crowdCheerTimer = 85;
    window.ymSynth.playSFX("StormF3");
    window.ymSynth.playSFX("FuePeeK");

    // Verifica se caiu DENTRO (IN) ou FORA (OUT) das linhas da quadra (COURT_LEFT_X .. COURT_RIGHT_X)
    const isOut = b.x < COURT_LEFT_X - 8 || b.x > COURT_RIGHT_X + 8;
    const landedSide = b.x < NET_X ? 0 : 1;

    let winnerSide = 0;
    if (isOut) {
      // Caiu fora: ponto para o lado oposto de quem tocou por último!
      winnerSide = 1 - match.lastHitterSide;
      match.lineJudgeState = "OUT";
      match.callText = "OUT!";
      window.ymSynth.speakCall("Out!");
    } else {
      // Caiu dentro da quadra: ponto para o lado oposto de onde a bola caiu!
      winnerSide = 1 - landedSide;
      match.lineJudgeState = "IN";
      match.callText = "IN!";

      // Contabiliza Aces de Saque, Cortada ou Bloqueio (para a tela de estatísticas 0x13E00)
      const winTeam = match.teams[winnerSide];
      if (match.lastHitterSide === winnerSide) {
        if (match.lastHitType === "SERVE") {
          winTeam.stats.serveAces++;
          match.callText = "SERVE ACE!";
          window.ymSynth.speakCall("Service Ace!");
        } else if (match.lastHitType === "SPIKE") {
          winTeam.stats.spikeAces++;
          window.ymSynth.speakCall("In! Point!");
        } else if (match.lastHitType === "BLOCK") {
          winTeam.stats.blockAces++;
          match.callText = "BLOCK POINT!";
          window.ymSynth.speakCall("Block Point!");
        } else {
          window.ymSynth.speakCall("In!");
        }
      } else {
        window.ymSynth.speakCall("In!");
      }
    }

    match.refereeSignal = winnerSide === 0 ? "LEFT_POINT" : "RIGHT_POINT";

    // Regra de pontuação: no Super Volley Ball (15 pontos, diferença de 2, teto 17)
    // Se quem venceu o rally NÃO estava sacando, faz a rotação (Side-Out) + marca ponto!
    if (winnerSide !== match.servingSide) {
      rotateTeam(match.teams[winnerSide]);
      match.servingSide = winnerSide;
      match.callSubText = match.teams[winnerSide].code + " SERVICE & POINT!";
    } else {
      match.callSubText = match.teams[winnerSide].code + " SCORES!";
    }

    match.teams[winnerSide].points++;

    // Verifica fim do Set (15 pontos com vantagem de 2, ou 17 pontos)
    const p0 = match.teams[0].points;
    const p1 = match.teams[1].points;
    if ((p0 >= 15 || p1 >= 15) && (Math.abs(p0 - p1) >= 2 || p0 >= 17 || p1 >= 17)) {
      const setWinner = p0 > p1 ? 0 : 1;
      match.teams[setWinner].setsWon++;
      match.setHistory.push({ p0, p1 });
      match.teams[0].superUsedThisSet = false;
      match.teams[1].superUsedThisSet = false;

      setTimeout(() => {
        if (gameState === "MATCH") {
          gameState = "SET_SUMMARY";
          window.ymSynth.speakCall("Game Set!");
        }
      }, 1400);
    }
  }

  // ============================================================================
  // SUBSTITUIÇÃO DE JOGADORES (TEAM MEMBER CHANGE - 0x13B00)
  // ============================================================================
  function updateSubstitutionModal() {
    const team = match.teams[0];
    if (isJustPressed("SUB", 1)) {
      subModalOpen = false;
      return;
    }
    if (!subSelectingBench) {
      if (isJustPressed("UP", 1)) {
        subCursorCourt = (subCursorCourt + 5) % 6;
        window.ymSynth.playSFX("menu_move");
      }
      if (isJustPressed("DOWN", 1)) {
        subCursorCourt = (subCursorCourt + 1) % 6;
        window.ymSynth.playSFX("menu_move");
      }
      if (isJustPressed("A", 1) || isJustPressed("START", 1)) {
        if (team.fullRoster.length > 6) {
          subSelectingBench = true;
          subCursorBench = 6;
          window.ymSynth.playSFX("menu_select");
        } else {
          // Se a seleção tem 6 jogadores, permite trocar a posição entre dois titulares na rotação
          subSelectingBench = true;
          subCursorBench = (subCursorCourt + 1) % 6;
          window.ymSynth.playSFX("menu_select");
        }
      }
    } else {
      const maxIdx = team.fullRoster.length;
      if (isJustPressed("UP", 1)) {
        subCursorBench = (subCursorBench - 1 + maxIdx) % maxIdx;
        window.ymSynth.playSFX("menu_move");
      }
      if (isJustPressed("DOWN", 1)) {
        subCursorBench = (subCursorBench + 1) % maxIdx;
        window.ymSynth.playSFX("menu_move");
      }
      if (isJustPressed("B", 1)) {
        subSelectingBench = false;
      }
      if (isJustPressed("A", 1) || isJustPressed("START", 1)) {
        // Troca os jogadores
        const temp = team.fullRoster[subCursorCourt];
        team.fullRoster[subCursorCourt] = team.fullRoster[subCursorBench];
        team.fullRoster[subCursorBench] = temp;
        for (let i = 0; i < 6; i++) {
          team.courtPlayers[i].data = team.fullRoster[i];
        }
        subSelectingBench = false;
        subModalOpen = false;
        window.ymSynth.playSFX("menu_select");
      }
    }
  }

  // ============================================================================
  // SISTEMA DE PASSWORD E TRAPAÇAS DA ROM ("STAFF" & "URAWAZA")
  // ============================================================================
  function generateLeaguePassword(teamIdx, stage) {
    const code = teams[teamIdx] ? teams[teamIdx].code : "BRA";
    const chk = ((teamIdx * 7 + stage * 13 + 91) % 90) + 10;
    return `SVB-${code}-S${stage + 1}-${chk}`;
  }

  function submitPassword() {
    const clean = passwordInput.trim().toUpperCase();
    if (clean === "STAFF" || clean === "SUTAFFU") {
      window.ymSynth.playSFX("Makyuu3");
      gameState = "STAFF_ROLL";
      window.ymSynth.startBGM("staff");
      return;
    }
    if (clean === "URAWAZA" || clean === "???") {
      options.unlockedSecret = true;
      window.ymSynth.playSFX("Makyuu3");
      p1TeamIdx = 8; // Seleção secreta ???
      initWorldLeague(p1TeamIdx, 0);
      return;
    }
    const m = clean.match(/^SVB-([A-Z\?]{3})-S([1-8])-(\d{2})$/);
    if (m) {
      const tCode = m[1];
      const stg = parseInt(m[2], 10) - 1;
      const foundIdx = teams.findIndex((t) => t.code === tCode);
      if (foundIdx >= 0) {
        p1TeamIdx = foundIdx;
        initWorldLeague(foundIdx, stg);
        window.ymSynth.playSFX("menu_select");
        return;
      }
    }
    // Se inválido, exibe aviso como na ROM ("YOU HAVE THE WRONG PASSWORD.")
    alert("YOU HAVE THE WRONG PASSWORD!\n\nDica: Use o formato SVB-BRA-S2-45 ou digite as senhas secretas da ROM:\n- STAFF (Créditos ocultos da Video System)\n- URAWAZA (Desbloqueia a seleção secreta ???)");
  }

  function initWorldLeague(playerTeamIdx, startStage = 0) {
    p1TeamIdx = playerTeamIdx;
    leagueStage = startStage;
    leagueOpponents = [];
    for (let i = 0; i < 8; i++) {
      if (i !== playerTeamIdx) leagueOpponents.push(i);
    }
    // 8ª partida secreta contra a Seleção ??? (URAWAZA)
    if (teams[8] && playerTeamIdx !== 8) {
      leagueOpponents.push(8);
    }
    leaguePassword = generateLeaguePassword(playerTeamIdx, leagueStage);
    gameState = "WORLD_LEAGUE_LADDER";
    window.ymSynth.startBGM("title");
  }

  // ============================================================================
  // ATUALIZAÇÃO DOS MENUS
  // ============================================================================
  function updateMenus() {
    if (gameState === "TITLE") {
      if (isJustPressed("START", 1) || isJustPressed("A", 1) || isJustPressed("B", 1)) {
        window.ymSynth.playSFX("menu_select");
        window.ymSynth.startBGM("title");
        gameState = "MAIN_MENU";
        menuCursor = 0;
      }
      return;
    }

    if (gameState === "MAIN_MENU") {
      const items = 6; // 1P GAME, 2P GAME, WATCH, ORIGINAL TEAM EDIT, OPTION, STAFF CREDITS
      if (isJustPressed("UP", 1)) {
        menuCursor = (menuCursor - 1 + items) % items;
        window.ymSynth.playSFX("menu_move");
      }
      if (isJustPressed("DOWN", 1)) {
        menuCursor = (menuCursor + 1) % items;
        window.ymSynth.playSFX("menu_move");
      }
      if (isJustPressed("START", 1) || isJustPressed("A", 1)) {
        window.ymSynth.playSFX("menu_select");
        if (menuCursor === 0) {
          gameState = "SUB_MENU_1P";
          subMenuCursor = 0;
        } else if (menuCursor === 1) {
          gameMode = "2P_NORMAL";
          selectPhase = 1;
          gameState = "TEAM_SELECT";
        } else if (menuCursor === 2) {
          gameMode = "WATCH";
          selectPhase = 1;
          gameState = "TEAM_SELECT";
        } else if (menuCursor === 3) {
          gameState = "TEAM_EDIT";
          editFieldIdx = 0;
        } else if (menuCursor === 4) {
          gameState = "OPTIONS";
          subMenuCursor = 0;
        } else if (menuCursor === 5) {
          gameState = "STAFF_ROLL";
          window.ymSynth.startBGM("staff");
        }
      }
      return;
    }

    if (gameState === "SUB_MENU_1P") {
      // 0: NORMAL GAME, 1: WORLD LEAGUE (START), 2: WORLD LEAGUE (CONTINUE / PASSWORD), 3: BACK
      if (isJustPressed("UP", 1)) {
        subMenuCursor = (subMenuCursor + 3) % 4;
        window.ymSynth.playSFX("menu_move");
      }
      if (isJustPressed("DOWN", 1)) {
        subMenuCursor = (subMenuCursor + 1) % 4;
        window.ymSynth.playSFX("menu_move");
      }
      if (isJustPressed("B", 1)) {
        gameState = "MAIN_MENU";
        window.ymSynth.playSFX("menu_move");
      }
      if (isJustPressed("START", 1) || isJustPressed("A", 1)) {
        window.ymSynth.playSFX("menu_select");
        if (subMenuCursor === 0) {
          gameMode = "1P_NORMAL";
          selectPhase = 1;
          gameState = "TEAM_SELECT";
        } else if (subMenuCursor === 1) {
          gameMode = "1P_LEAGUE";
          selectPhase = 1;
          gameState = "TEAM_SELECT";
        } else if (subMenuCursor === 2) {
          passwordInput = "";
          gameState = "PASSWORD";
        } else {
          gameState = "MAIN_MENU";
        }
      }
      return;
    }

    if (gameState === "PASSWORD") {
      if (isJustPressed("B", 1) && passwordInput.length === 0) {
        gameState = "SUB_MENU_1P";
      }
      return;
    }

    if (gameState === "TEAM_SELECT") {
      const maxTeams = options.unlockedSecret ? teams.length : 8;
      if (selectPhase === 1) {
        if (isJustPressed("LEFT", 1)) {
          p1TeamIdx = (p1TeamIdx - 1 + maxTeams) % maxTeams;
          window.ymSynth.playSFX("menu_move");
        }
        if (isJustPressed("RIGHT", 1)) {
          p1TeamIdx = (p1TeamIdx + 1) % maxTeams;
          window.ymSynth.playSFX("menu_move");
        }
        if (isJustPressed("UP", 1) || isJustPressed("DOWN", 1)) {
          p1TeamIdx = (p1TeamIdx + 4) % maxTeams;
          window.ymSynth.playSFX("menu_move");
        }
        if (isJustPressed("B", 1)) {
          gameState = "MAIN_MENU";
        }
        if (isJustPressed("A", 1) || isJustPressed("START", 1)) {
          window.ymSynth.playSFX("menu_select");
          if (gameMode === "1P_LEAGUE") {
            initWorldLeague(p1TeamIdx, 0);
          } else {
            selectPhase = 2;
            p2TeamIdx = (p1TeamIdx + 1) % 8;
          }
        }
      } else {
        if (isJustPressed("LEFT", 1) || isJustPressed("LEFT", 2)) {
          p2TeamIdx = (p2TeamIdx - 1 + maxTeams) % maxTeams;
          window.ymSynth.playSFX("menu_move");
        }
        if (isJustPressed("RIGHT", 1) || isJustPressed("RIGHT", 2)) {
          p2TeamIdx = (p2TeamIdx + 1) % maxTeams;
          window.ymSynth.playSFX("menu_move");
        }
        if (isJustPressed("UP", 1) || isJustPressed("DOWN", 1)) {
          p2TeamIdx = (p2TeamIdx + 4) % maxTeams;
          window.ymSynth.playSFX("menu_move");
        }
        if (isJustPressed("B", 1)) {
          selectPhase = 1;
        }
        if (isJustPressed("A", 1) || isJustPressed("START", 1) || isJustPressed("A", 2)) {
          window.ymSynth.playSFX("menu_select");
          startMatch(p1TeamIdx, p2TeamIdx, gameMode);
        }
      }
      return;
    }

    if (gameState === "WORLD_LEAGUE_LADDER") {
      if (isJustPressed("B", 1)) {
        gameState = "MAIN_MENU";
      }
      if (isJustPressed("A", 1) || isJustPressed("START", 1)) {
        window.ymSynth.playSFX("menu_select");
        p2TeamIdx = leagueOpponents[leagueStage] || 0;
        startMatch(p1TeamIdx, p2TeamIdx, "1P_LEAGUE");
      }
      return;
    }

    if (gameState === "SET_SUMMARY") {
      if (isJustPressed("A", 1) || isJustPressed("START", 1)) {
        window.ymSynth.playSFX("menu_select");
        const s0 = match.teams[0].setsWon;
        const s1 = match.teams[1].setsWon;
        if (s0 >= options.setsToWin || s1 >= options.setsToWin) {
          // Fim da partida!
          if (gameMode === "1P_LEAGUE") {
            if (s0 > s1) {
              leagueStage++;
              if (leagueStage >= leagueOpponents.length) {
                gameState = "STAFF_ROLL";
                window.ymSynth.startBGM("staff");
              } else {
                leaguePassword = generateLeaguePassword(p1TeamIdx, leagueStage);
                gameState = "WORLD_LEAGUE_LADDER";
                window.ymSynth.startBGM("title");
              }
            } else {
              // Perdeu na World League -> volta para o ladder com o password atual para Continue
              gameState = "WORLD_LEAGUE_LADDER";
              window.ymSynth.startBGM("title");
            }
          } else {
            gameState = "MAIN_MENU";
            window.ymSynth.startBGM("title");
          }
        } else {
          // Próximo Set!
          match.currentSet++;
          match.teams[0].points = options.beginningPoints;
          match.teams[1].points = options.beginningPoints;
          setupServe(match.currentSet % 2 === 1 ? 0 : 1);
          gameState = "MATCH";
          window.ymSynth.playSFX("FuePeeK");
        }
      }
      return;
    }

    if (gameState === "TEAM_EDIT") {
      const team = teams[editTeamIdx];
      const player = team.roster[editPlayerIdx];
      if (isJustPressed("UP", 1)) {
        editFieldIdx = (editFieldIdx + 6) % 7;
        window.ymSynth.playSFX("menu_move");
      }
      if (isJustPressed("DOWN", 1)) {
        editFieldIdx = (editFieldIdx + 1) % 7;
        window.ymSynth.playSFX("menu_move");
      }
      if (isJustPressed("LEFT", 1) || isJustPressed("RIGHT", 1)) {
        const d = isJustPressed("RIGHT", 1) ? 1 : -1;
        window.ymSynth.playSFX("menu_move");
        if (editFieldIdx === 0) {
          editTeamIdx = (editTeamIdx + d + 8) % 8;
          editPlayerIdx = 0;
        } else if (editFieldIdx === 1) {
          editPlayerIdx = (editPlayerIdx + d + team.roster.length) % team.roster.length;
        } else if (editFieldIdx === 2) {
          player.number = Math.max(1, Math.min(15, player.number + d));
        } else if (editFieldIdx === 3) {
          player.sp = Math.max(2, Math.min(8, player.sp + d));
        } else if (editFieldIdx === 4) {
          player.re = Math.max(2, Math.min(8, player.re + d));
        } else if (editFieldIdx === 5) {
          player.sv = Math.max(2, Math.min(8, player.sv + d));
        } else if (editFieldIdx === 6) {
          player.bl = Math.max(2, Math.min(8, player.bl + d));
        }
      }
      if (isJustPressed("B", 1) || isJustPressed("START", 1)) {
        gameState = "MAIN_MENU";
        window.ymSynth.playSFX("menu_select");
      }
      return;
    }

    if (gameState === "OPTIONS") {
      // 0: BALL SPEED, 1: BEGINNING POINTS, 2: SETS TO WIN, 3: NAME INDICATION, 4: SECRET TEAM, 5: SOUND TEST, 6: EXIT
      if (isJustPressed("UP", 1)) {
        subMenuCursor = (subMenuCursor + 6) % 7;
        window.ymSynth.playSFX("menu_move");
      }
      if (isJustPressed("DOWN", 1)) {
        subMenuCursor = (subMenuCursor + 1) % 7;
        window.ymSynth.playSFX("menu_move");
      }
      if (isJustPressed("LEFT", 1) || isJustPressed("RIGHT", 1)) {
        const d = isJustPressed("RIGHT", 1) ? 1 : -1;
        window.ymSynth.playSFX("menu_move");
        if (subMenuCursor === 0) {
          const spds = ["SLOW", "NORMAL", "FAST"];
          options.ballSpeed = spds[(spds.indexOf(options.ballSpeed) + d + 3) % 3];
        } else if (subMenuCursor === 1) {
          const pts = [0, 5, 10, 14];
          options.beginningPoints = pts[(pts.indexOf(options.beginningPoints) + d + 4) % 4];
        } else if (subMenuCursor === 2) {
          options.setsToWin = Math.max(1, Math.min(3, options.setsToWin + d));
        } else if (subMenuCursor === 3) {
          options.nameIndication = !options.nameIndication;
        } else if (subMenuCursor === 4) {
          options.unlockedSecret = !options.unlockedSecret;
        } else if (subMenuCursor === 5) {
          const sfxList = ["FuePeeK", "SpikeOku1", "Makyuu3", "ServeNew1", "Toss1", "NewBlock2", "NewRecv1", "StormF3"];
          options.soundTestIdx = (options.soundTestIdx + d + sfxList.length) % sfxList.length;
          window.ymSynth.playSFX(sfxList[options.soundTestIdx]);
        }
      }
      if ((isJustPressed("A", 1) || isJustPressed("START", 1)) && subMenuCursor === 6) {
        gameState = "MAIN_MENU";
        window.ymSynth.playSFX("menu_select");
      }
      if (isJustPressed("B", 1)) {
        gameState = "MAIN_MENU";
      }
      return;
    }

    if (gameState === "STAFF_ROLL") {
      if (isJustPressed("START", 1) || isJustPressed("A", 1) || isJustPressed("B", 1)) {
        gameState = "MAIN_MENU";
        window.ymSynth.startBGM("title");
      }
    }
  }

  // ============================================================================
  // RENDERIZAÇÃO ESTILO VDP SEGA MEGA DRIVE / GENESIS
  // ============================================================================
  function drawPixelText(text, x, y, size = 18, color = "#FCFCFC", align = "left", shadow = "#000000") {
    ctx.save();
    ctx.font = `bold ${size}px "Courier New", monospace`;
    ctx.textAlign = align;
    if (shadow) {
      ctx.fillStyle = shadow;
      ctx.fillText(text, x + 2, y + 2);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawFlag(code, x, y, w, h) {
    ctx.save();
    ctx.strokeStyle = "#FCFCFC";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    if (code === "BRA") {
      ctx.fillStyle = "#00A800";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#FCFC00";
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + 4);
      ctx.lineTo(x + w - 5, y + h / 2);
      ctx.lineTo(x + w / 2, y + h - 4);
      ctx.lineTo(x + 5, y + h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#0000B4";
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, h * 0.24, 0, Math.PI * 2);
      ctx.fill();
    } else if (code === "USA") {
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = i % 2 === 0 ? "#D80000" : "#FCFCFC";
        ctx.fillRect(x, y + (i * h) / 7, w, h / 7 + 1);
      }
      ctx.fillStyle = "#000090";
      ctx.fillRect(x, y, w * 0.45, h * 0.55);
    } else if (code === "URS") {
      ctx.fillStyle = "#D80000";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#FCFC00";
      ctx.fillRect(x + 6, y + 6, 8, 8);
    } else if (code === "JPN") {
      ctx.fillStyle = "#FCFCFC";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#FC0000";
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, h * 0.28, 0, Math.PI * 2);
      ctx.fill();
    } else if (code === "ITA") {
      ctx.fillStyle = "#009000";
      ctx.fillRect(x, y, w / 3, h);
      ctx.fillStyle = "#FCFCFC";
      ctx.fillRect(x + w / 3, y, w / 3, h);
      ctx.fillStyle = "#D80000";
      ctx.fillRect(x + (2 * w) / 3, y, w / 3, h);
    } else if (code === "FRA") {
      ctx.fillStyle = "#0000B4";
      ctx.fillRect(x, y, w / 3, h);
      ctx.fillStyle = "#FCFCFC";
      ctx.fillRect(x + w / 3, y, w / 3, h);
      ctx.fillStyle = "#D80000";
      ctx.fillRect(x + (2 * w) / 3, y, w / 3, h);
    } else if (code === "HOL") {
      ctx.fillStyle = "#D80000";
      ctx.fillRect(x, y, w, h / 3);
      ctx.fillStyle = "#FCFCFC";
      ctx.fillRect(x, y + h / 3, w, h / 3);
      ctx.fillStyle = "#0000B4";
      ctx.fillRect(x, y + (2 * h) / 3, w, h / 3);
    } else if (code === "CHN") {
      ctx.fillStyle = "#D80000";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#FCFC00";
      ctx.beginPath();
      ctx.arc(x + 12, y + 10, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#6C006C";
      ctx.fillRect(x, y, w, h);
      drawPixelText("???", x + w / 2, y + h / 2 + 5, 14, "#FCFC00", "center");
    }
    ctx.restore();
  }

  function renderTitleScreen() {
    // Fundo azul escuro da paleta 0x142A0 do Mega Drive
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#001228");
    grad.addColorStop(0.6, "#002448");
    grad.addColorStop(1, "#000914");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Linhas de grade em perspectiva retrô
    ctx.strokeStyle = "rgba(0, 144, 252, 0.2)";
    ctx.lineWidth = 1;
    for (let y = 340; y < H; y += 22) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Emblema clássico "SUPER VOLLEY BALL" (3C000-3FFFF na ROM)
    ctx.save();
    ctx.fillStyle = "#900000";
    ctx.fillRect(W / 2 - 330, 75, 660, 155);
    ctx.strokeStyle = "#FCFC00";
    ctx.lineWidth = 4;
    ctx.strokeRect(W / 2 - 330, 75, 660, 155);

    drawPixelText("SEGA GENESIS / MEGA DRIVE (GM T-30016-00)", W / 2, 105, 15, "#00D8FC", "center");
    drawPixelText("SUPER VOLLEY BALL", W / 2, 165, 58, "#FCFCFC", "center", "#000048");
    drawPixelText("PC WINDOWS EDITION  •  REA REVERSE ENGINEERED", W / 2, 208, 16, "#FCFC00", "center");
    ctx.restore();

    // Bola de vôlei animada cruzando a tela
    const bx = W / 2 + Math.cos(frameCount * 0.04) * 220;
    const by = 290 + Math.sin(frameCount * 0.08) * 28;
    drawVolleyball(bx, by, 24, false, frameCount * 0.1);

    // Bandeiras das 8 seleções da ROM
    for (let i = 0; i < 8; i++) {
      const fx = 135 + i * 90;
      drawFlag(teams[i].code, fx, 345, 64, 40);
      drawPixelText(teams[i].code, fx + 32, 404, 15, "#FCFCFC", "center");
    }

    if (Math.floor(frameCount / 25) % 2 === 0) {
      drawPixelText("PUSH START / ENTER / Z BUTTON", W / 2, 462, 24, "#FCFC00", "center");
    }

    drawPixelText("(C) 1991 VIDEO SYSTEM CO., LTD.  •  LICENSED BY SEGA ENTERPRISES, LTD.", W / 2, 515, 14, "#B4B4B4", "center");
  }

  function renderMainMenu() {
    ctx.fillStyle = "#001B36";
    ctx.fillRect(0, 0, W, H);

    drawPixelText("SUPER VOLLEY BALL - MAIN MENU", W / 2, 65, 32, "#FCFC00", "center");
    drawPixelText("ROM OFFSET 0x12EE0 • SELECT MODE", W / 2, 95, 15, "#4890FC", "center");

    const items = [
      "1 PLAYER GAME (NORMAL / WORLD LEAGUE)",
      "2 PLAYER GAME (1P VS 2P LOCAL)",
      "WATCH A GAME (CPU VS CPU)",
      "ORIGINAL TEAM EDIT (ROSTER & STATS)",
      "OPTION & SOUND TEST (YM2612 / SFX)",
      "STAFF CREDITS (PASSWORD: STAFF)"
    ];

    for (let i = 0; i < items.length; i++) {
      const y = 165 + i * 52;
      const active = menuCursor === i;
      ctx.fillStyle = active ? "#900000" : "rgba(0, 36, 72, 0.85)";
      ctx.fillRect(W / 2 - 290, y - 28, 580, 40);
      ctx.strokeStyle = active ? "#FCFC00" : "#486CFC";
      ctx.lineWidth = active ? 3 : 1;
      ctx.strokeRect(W / 2 - 290, y - 28, 580, 40);

      if (active) {
        drawVolleyball(W / 2 - 260, y - 8, 11, false, frameCount * 0.15);
      }
      drawPixelText(items[i], W / 2, y - 2, 20, active ? "#FCFC00" : "#FCFCFC", "center");
    }

    drawPixelText("CONTROLES: SETAS/WASD = MOVER  |  Z/ENTER = CONFIRMAR  |  X = VOLTAR", W / 2, 510, 14, "#B4B4B4", "center");
  }

  function renderSubMenu1P() {
    ctx.fillStyle = "#001B36";
    ctx.fillRect(0, 0, W, H);
    drawPixelText("ONE PLAYER GAME (0x13578)", W / 2, 85, 32, "#FCFC00", "center");

    const items = [
      "NORMAL GAME (EXHIBITION MATCH)",
      "WORLD LEAGUE - START NEW CAMPAIGN",
      "WORLD LEAGUE - CONTINUE (INPUT PASSWORD)",
      "RETURN TO MAIN MENU"
    ];

    for (let i = 0; i < items.length; i++) {
      const y = 190 + i * 62;
      const active = subMenuCursor === i;
      ctx.fillStyle = active ? "#004890" : "rgba(0, 36, 72, 0.8)";
      ctx.fillRect(W / 2 - 280, y - 30, 560, 44);
      ctx.strokeStyle = active ? "#FCFC00" : "#486CFC";
      ctx.lineWidth = 2;
      ctx.strokeRect(W / 2 - 280, y - 30, 560, 44);
      drawPixelText(items[i], W / 2, y - 2, 20, active ? "#FCFC00" : "#FCFCFC", "center");
    }
  }

  function renderPasswordScreen() {
    ctx.fillStyle = "#001830";
    ctx.fillRect(0, 0, W, H);
    drawPixelText("WORLD LEAGUE - INPUT PASSWORD (0x136FC)", W / 2, 90, 28, "#FCFC00", "center");

    ctx.fillStyle = "#000C18";
    ctx.fillRect(W / 2 - 220, 170, 440, 64);
    ctx.strokeStyle = "#00D8FC";
    ctx.lineWidth = 3;
    ctx.strokeRect(W / 2 - 220, 170, 440, 64);

    const blink = Math.floor(frameCount / 20) % 2 === 0 ? "_" : " ";
    drawPixelText(passwordInput + blink, W / 2, 212, 32, "#FCFCFC", "center");

    drawPixelText("DIGITE A SENHA NO TECLADO E PRESSIONE ENTER", W / 2, 285, 18, "#00FC00", "center");
    drawPixelText("SENHAS SECRETAS DESCOBERTAS NA ROM (TCRF / 0x14DA0):", W / 2, 355, 16, "#FCFC00", "center");
    drawPixelText("• URAWAZA  -> Desbloqueia a Seleção Secreta '???' (0x14F3A)", W / 2, 388, 16, "#FCFCFC", "center");
    drawPixelText("• STAFF    -> Exibe os Créditos Ocultos da Video System", W / 2, 418, 16, "#FCFCFC", "center");
    drawPixelText("• SVB-BRA-S2-45 -> Exemplo de Password de Fase da World League", W / 2, 448, 16, "#B4B4B4", "center");
  }

  function renderTeamSelect() {
    ctx.fillStyle = "#001830";
    ctx.fillRect(0, 0, W, H);

    drawPixelText(
      selectPhase === 1 ? "TEAM SELECT - CHOOSE 1P TEAM (0x135FE)" : "TEAM SELECT - CHOOSE OPPONENT TEAM",
      W / 2, 50, 26, "#FCFC00", "center"
    );

    const maxTeams = options.unlockedSecret ? teams.length : 8;
    for (let i = 0; i < maxTeams; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 95 + col * 200;
      const y = 85 + row * 120;
      const isP1 = p1TeamIdx === i;
      const isP2 = selectPhase === 2 && p2TeamIdx === i;

      ctx.fillStyle = isP1 ? "rgba(0, 120, 255, 0.35)" : isP2 ? "rgba(255, 50, 50, 0.35)" : "rgba(0, 36, 72, 0.8)";
      ctx.fillRect(x, y, 170, 98);
      ctx.strokeStyle = isP1 ? "#00FCFC" : isP2 ? "#FC4848" : "#486CFC";
      ctx.lineWidth = isP1 || isP2 ? 3 : 1;
      ctx.strokeRect(x, y, 170, 98);

      drawFlag(teams[i].code, x + 53, y + 12, 64, 40);
      drawPixelText(teams[i].code, x + 85, y + 74, 20, "#FCFCFC", "center");
      if (isP1) drawPixelText("1P", x + 24, y + 30, 16, "#00FCFC", "center");
      if (isP2) drawPixelText(gameMode === "2P_NORMAL" ? "2P" : "CPU", x + 144, y + 30, 16, "#FC4848", "center");
    }

    // Painel inferior com o elenco real extraído da ROM (0x1503A+)
    const focusedIdx = selectPhase === 1 ? p1TeamIdx : p2TeamIdx;
    const t = teams[focusedIdx];
    if (t) {
      ctx.fillStyle = "rgba(0, 12, 28, 0.92)";
      ctx.fillRect(60, 335, W - 120, 175);
      ctx.strokeStyle = "#FCFC00";
      ctx.lineWidth = 2;
      ctx.strokeRect(60, 335, W - 120, 175);

      drawPixelText(`${t.name}  [ROM ${t.rom_offset} | PALETTE #${t.palette_primary_id}]`, 85, 365, 19, "#FCFC00");
      drawPixelText(
        `MÉDIA: SP ${t.stats_avg.sp}  RE ${t.stats_avg.re}  SV ${t.stats_avg.sv}  BL ${t.stats_avg.bl}`,
        W - 85, 365, 17, "#00FC00", "right"
      );

      for (let i = 0; i < Math.min(8, t.roster.length); i++) {
        const p = t.roster[i];
        const px = 85 + (i % 4) * 205;
        const py = 405 + Math.floor(i / 4) * 52;
        drawPixelText(`#${String(p.number).padStart(2, "0")} ${p.name}`, px, py, 17, "#FCFCFC");
        drawPixelText(`SP:${p.sp} RE:${p.re} SV:${p.sv} BL:${p.bl}`, px, py + 20, 13, "#4890FC");
      }
    }
  }

  function renderWorldLeagueLadder() {
    ctx.fillStyle = "#001830";
    ctx.fillRect(0, 0, W, H);

    const myTeam = teams[p1TeamIdx];
    drawPixelText("WORLD LEAGUE CHAMPIONSHIP", W / 2, 55, 30, "#FCFC00", "center");
    drawPixelText(`PLAYER TEAM: ${myTeam.name}   •   PASSWORD: ${leaguePassword}`, W / 2, 90, 18, "#00FCFC", "center");

    for (let i = 0; i < leagueOpponents.length; i++) {
      const opp = teams[leagueOpponents[i]];
      const y = 135 + i * 42;
      const isCurrent = i === leagueStage;
      const isDone = i < leagueStage;

      ctx.fillStyle = isCurrent ? "#900000" : isDone ? "rgba(0, 100, 40, 0.6)" : "rgba(0, 36, 72, 0.7)";
      ctx.fillRect(W / 2 - 280, y - 24, 560, 34);
      ctx.strokeStyle = isCurrent ? "#FCFC00" : "#486CFC";
      ctx.strokeRect(W / 2 - 280, y - 24, 560, 34);

      const status = isDone ? "WON (CLEAR)" : isCurrent ? "NEXT MATCH << PRESS START >>" : "LOCKED";
      drawPixelText(`ROUND ${i + 1}: VS ${opp.code} (${opp.name})`, W / 2 - 260, y - 2, 16, "#FCFCFC");
      drawPixelText(status, W / 2 + 260, y - 2, 15, isDone ? "#00FC00" : isCurrent ? "#FCFC00" : "#909090", "right");
    }
  }

  function renderTeamEdit() {
    ctx.fillStyle = "#001830";
    ctx.fillRect(0, 0, W, H);
    drawPixelText("ORIGINAL TEAM EDIT (ROM 0x12F8A - 0x13480)", W / 2, 55, 28, "#FCFC00", "center");

    const team = teams[editTeamIdx];
    const p = team.roster[editPlayerIdx];

    const rows = [
      `SELEÇÃO (TEAM): < ${team.code} - ${team.name} >`,
      `JOGADOR (PLAYER ${editPlayerIdx + 1}/${team.roster.length}): < ${p.name} (ROM ${p.rom_offset}) >`,
      `HIS UNIFORM NUMBER IS: < #${p.number} >`,
      `ABILITY SP (SPIKE / CORTADA):   < ${p.sp} >   [${"█".repeat(p.sp)}${"░".repeat(8 - p.sp)}]`,
      `ABILITY RE (RECEIVE / DEFESA):  < ${p.re} >   [${"█".repeat(p.re)}${"░".repeat(8 - p.re)}]`,
      `ABILITY SV (SERVE / SAQUE):     < ${p.sv} >   [${"█".repeat(p.sv)}${"░".repeat(8 - p.sv)}]`,
      `ABILITY BL (BLOCK / BLOQUEIO):  < ${p.bl} >   [${"█".repeat(p.bl)}${"░".repeat(8 - p.bl)}]`
    ];

    for (let i = 0; i < rows.length; i++) {
      const y = 135 + i * 48;
      const active = editFieldIdx === i;
      ctx.fillStyle = active ? "#004890" : "rgba(0, 36, 72, 0.75)";
      ctx.fillRect(110, y - 28, W - 220, 38);
      ctx.strokeStyle = active ? "#FCFC00" : "#486CFC";
      ctx.strokeRect(110, y - 28, W - 220, 38);
      drawPixelText(rows[i], 135, y - 3, 19, active ? "#FCFC00" : "#FCFCFC");
    }

    drawPixelText("SETAS ESQ/DIR = ALTERAR VALOR  |  X / ENTER = SALVAR E VOLTAR AO MENU", W / 2, 505, 15, "#00FC00", "center");
  }

  function renderOptions() {
    ctx.fillStyle = "#001830";
    ctx.fillRect(0, 0, W, H);
    drawPixelText("OPTION & SOUND TEST (ROM 0x13A38)", W / 2, 60, 28, "#FCFC00", "center");

    const sfxList = ["FuePeeK (Whistle)", "SpikeOku1 (Spike)", "Makyuu3 (Miracle Serve)", "ServeNew1 (Toss)", "Toss1 (Set)", "NewBlock2 (Block)", "NewRecv1 (Dig)", "StormF3 (Crowd)"];
    const items = [
      `BALL SPEED: < ${options.ballSpeed} >`,
      `BEGINNING POINTS: < ${options.beginningPoints} - ${options.beginningPoints} >`,
      `SETS TO WIN MATCH: < ${options.setsToWin} SETS >`,
      `NAME INDICATION ON COURT: < ${options.nameIndication ? "YES" : "NO"} >`,
      `URAWAZA SECRET TEAM (???): < ${options.unlockedSecret ? "UNLOCKED" : "LOCKED"} >`,
      `SOUND TEST (ROM SFX): < ${sfxList[options.soundTestIdx]} >`,
      "EXIT TO MAIN MENU"
    ];

    for (let i = 0; i < items.length; i++) {
      const y = 135 + i * 50;
      const active = subMenuCursor === i;
      ctx.fillStyle = active ? "#900000" : "rgba(0, 36, 72, 0.75)";
      ctx.fillRect(150, y - 28, W - 300, 38);
      ctx.strokeStyle = active ? "#FCFC00" : "#486CFC";
      ctx.strokeRect(150, y - 28, W - 300, 38);
      drawPixelText(items[i], W / 2, y - 3, 19, active ? "#FCFC00" : "#FCFCFC", "center");
    }
  }

  function renderSetSummary() {
    ctx.fillStyle = "#001830";
    ctx.fillRect(0, 0, W, H);

    const t0 = match.teams[0];
    const t1 = match.teams[1];
    const rate = (aces, tot) => (tot > 0 ? Math.round((aces / tot) * 100) : 0);

    drawPixelText(`END OF SET ${match.currentSet}  •  STATISTICS (ROM 0x13E08)`, W / 2, 55, 26, "#FCFC00", "center");
    drawPixelText(`${t0.code}  ${t0.setsWon}  -  ${t1.setsWon}  ${t1.code}`, W / 2, 100, 36, "#FCFCFC", "center");

    const rows = [
      ["SERVE ACE RATE", `${rate(t0.stats.serveAces, t0.stats.serves)}% (${t0.stats.serveAces}/${t0.stats.serves})`, `${rate(t1.stats.serveAces, t1.stats.serves)}% (${t1.stats.serveAces}/${t1.stats.serves})`],
      ["SPIKE ACE RATE", `${rate(t0.stats.spikeAces, t0.stats.spikes)}% (${t0.stats.spikeAces}/${t0.stats.spikes})`, `${rate(t1.stats.spikeAces, t1.stats.spikes)}% (${t1.stats.spikeAces}/${t1.stats.spikes})`],
      ["BLOCK ACE RATE", `${rate(t0.stats.blockAces, t0.stats.blocks)}% (${t0.stats.blockAces}/${t0.stats.blocks})`, `${rate(t1.stats.blockAces, t1.stats.blocks)}% (${t1.stats.blockAces}/${t1.stats.blocks})`]
    ];

    for (let i = 0; i < rows.length; i++) {
      const y = 180 + i * 58;
      ctx.fillStyle = "rgba(0, 36, 72, 0.85)";
      ctx.fillRect(110, y - 28, W - 220, 42);
      drawPixelText(rows[i][1], 140, y, 20, "#00FCFC", "left");
      drawPixelText(rows[i][0], W / 2, y, 20, "#FCFC00", "center");
      drawPixelText(rows[i][2], W - 140, y, 20, "#FC6C6C", "right");
    }

    // Frase autêntica do técnico extraída de 0x13B90 - 0x13D70 da ROM
    const won = t0.points > t1.points;
    const quote = won
      ? (t0.setsWon >= options.setsToWin ? "HEY! GREAT JOB. WE'RE THE CHAMPS." : "LET'S GO FOR THE GOLD. WE CAN DO IT!")
      : "SORRY-COACH. WE'LL TRY HARDER NEXT TIME!";

    ctx.fillStyle = "#000C18";
    ctx.fillRect(110, 365, W - 220, 75);
    ctx.strokeStyle = "#FCFC00";
    ctx.strokeRect(110, 365, W - 220, 75);
    drawPixelText(`COACH MESSAGE: "${quote}"`, W / 2, 410, 20, "#00FC00", "center");

    drawPixelText("PRESSIONE ENTER / Z PARA CONTINUAR", W / 2, 495, 20, "#FCFC00", "center");
  }

  function renderStaffRoll() {
    ctx.fillStyle = "#000C1A";
    ctx.fillRect(0, 0, W, H);

    drawPixelText("SUPER VOLLEY BALL - HIDDEN STAFF ROLL (0x14DA0)", W / 2, 75, 28, "#FCFC00", "center");
    drawPixelText("CONGRATULATIONS! WORLD LEAGUE CHAMPIONS!", W / 2, 118, 22, "#00FC00", "center");

    const credits = [
      ["ORIGINAL DEVELOPER", "VIDEO SYSTEM CO., LTD. / MICRONICS (1991)"],
      ["PROGRAMMER (0x14DD8)", "MASAHIKO TSUKADA"],
      ["GRAPHIC DESIGNERS (0x14DFC)", "SHINSUKE NAKAMURA  •  SHOUKO ISHIMOTO"],
      ["MUSIC & YM2612 FM (0x14E48)", "KENJI OKUDA  •  NAOKI ITAMURA"],
      ["REVERSE ENGINEERING ENGINE", "REA (morluto/rea) BINARY & VDP EXTRACTOR"],
      ["PC WINDOWS PORT", "SUPER VOLLEY BALL PC EDITION (GM T-30016-00)"]
    ];

    for (let i = 0; i < credits.length; i++) {
      const y = 175 + i * 50;
      drawPixelText(credits[i][0], W / 2, y, 15, "#4890FC", "center");
      drawPixelText(credits[i][1], W / 2, y + 22, 20, "#FCFCFC", "center");
    }

    drawPixelText("PRESSIONE ENTER / Z PARA VOLTAR AO MENU", W / 2, 505, 18, "#FCFC00", "center");
  }

  // ============================================================================
  // RENDERIZAÇÃO DA QUADRA E PARTIDA (ESTÁDIO 2D SIDE-SCROLLING MEGA DRIVE)
  // ============================================================================
  function renderMatch() {
    ctx.save();
    if (screenShake > 0) {
      ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
    }

    // 1. Arquibancada e Placar Eletrônico Superior (Fixo na tela / Parallax)
    ctx.fillStyle = "#001428";
    ctx.fillRect(0, 0, W, 195);

    // Torcida animada nas arquibancadas (baseado no banco 0x20000 da ROM)
    const cheering = crowdCheerTimer > 0;
    for (let row = 0; row < 3; row++) {
      for (let c = 0; c < 34; c++) {
        const cx = ((c * 32 - Math.floor(camX * 0.35)) % (W + 32) + (W + 32)) % (W + 32) - 16;
        const bounce = cheering ? Math.abs(Math.sin(frameCount * 0.35 + c)) * 6 : 0;
        const cy = 92 + row * 24 - bounce;
        ctx.fillStyle = (c + row) % 3 === 0 ? "#D84824" : (c + row) % 3 === 1 ? "#486CFC" : "#FCFC00";
        ctx.fillRect(cx, cy, 14, 12);
        ctx.fillStyle = "#FCB490";
        ctx.fillRect(cx + 3, cy - 7, 8, 7);
      }
    }

    // 2. Mundo da Quadra com Scroll Horizontal (camX)
    ctx.save();
    ctx.translate(-Math.floor(camX), 0);

    // Placas publicitárias ao fundo da quadra ("V-SYSTEM", "VIDEO SYSTEM", "SUPER VOLLEY BALL")
    ctx.fillStyle = "#B40000";
    ctx.fillRect(40, 168, WORLD_W - 80, 34);
    ctx.strokeStyle = "#FCFCFC";
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 168, WORLD_W - 80, 34);
    for (let bx = 90; bx < WORLD_W - 120; bx += 260) {
      drawPixelText("V-SYSTEM  •  SUPER VOLLEY BALL", bx, 191, 16, "#FCFCFC", "left", "#000000");
    }

    // Área externa da quadra (Verde-azulado característico da versão Mega Drive)
    ctx.fillStyle = "#007860";
    ctx.fillRect(0, 202, WORLD_W, H - 202);

    // Piso de madeira de lei da quadra (Hardwood Court: COURT_LEFT_X .. COURT_RIGHT_X)
    const courtGrad = ctx.createLinearGradient(0, 360, 0, 480);
    courtGrad.addColorStop(0, "#D88038");
    courtGrad.addColorStop(0.5, "#C86C24");
    courtGrad.addColorStop(1, "#A85418");
    ctx.fillStyle = courtGrad;
    ctx.beginPath();
    ctx.moveTo(COURT_LEFT_X + 35, 375);
    ctx.lineTo(COURT_RIGHT_X - 35, 375);
    ctx.lineTo(COURT_RIGHT_X + 25, 472);
    ctx.lineTo(COURT_LEFT_X - 25, 472);
    ctx.closePath();
    ctx.fill();

    // Linhas brancas da quadra (Linhas de fundo, laterais e linhas de 3 metros)
    ctx.strokeStyle = "#FCFCFC";
    ctx.lineWidth = 4;
    ctx.stroke();

    // Linhas de ataque de 3m (Esquerda e Direita)
    const drawCourtLine = (xTop, xBot) => {
      ctx.beginPath();
      ctx.moveTo(xTop, 375);
      ctx.lineTo(xBot, 472);
      ctx.stroke();
    };
    drawCourtLine(NET_X - 175, NET_X - 195);
    drawCourtLine(NET_X + 175, NET_X + 195);
    drawCourtLine(NET_X, NET_X);

    // Árbitro Principal na cadeira elevada junto à rede + Juízes de Linha com bandeirinhas
    drawRefereeAndLineJudges();

    // Sombra projetada no chão do ponto de queda estimado da bola (indicador tático)
    if (match.rallyState === "IN_PLAY" && match.ball.targetX > 60 && match.ball.targetX < WORLD_W - 60) {
      ctx.strokeStyle = "rgba(252, 252, 0, 0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(match.ball.targetX, FLOOR_Y + 4, 16, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Sombra real da bola no chão
    const shadowScale = Math.max(0.25, 1 - (FLOOR_Y - match.ball.y) / 380);
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.ellipse(match.ball.x, FLOOR_Y + 4, 15 * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Desenha os 12 jogadores ordenados por profundidade (z)
    const allPlayers = [...match.teams[0].courtPlayers, ...match.teams[1].courtPlayers].sort((a, b) => a.z - b.z);
    const activeP0 = getClosestCourtPlayerIndex(match.teams[0], match.ball.targetX);
    const activeP1 = getClosestCourtPlayerIndex(match.teams[1], match.ball.targetX);

    for (const p of allPlayers) {
      const team = match.teams[p.side];
      const isControlled = (p.side === 0 && !team.isCPU && p.slot === activeP0) ||
                           (p.side === 1 && !team.isCPU && p.slot === activeP1);
      drawPlayerSprite(p, team, isControlled);
    }

    // Rede Central de Voleibol com malha quadriculada e antena vermelha/branca
    drawVolleyballNet();

    // Trilha de energia (Super Saque Jornada nas Estrelas / Super Cortada) e Bola
    for (let i = 0; i < match.ball.trail.length; i++) {
      const tr = match.ball.trail[i];
      const alpha = (i + 1) / match.ball.trail.length * 0.55;
      ctx.fillStyle = tr.super ? `rgba(252, 60, 0, ${alpha})` : `rgba(252, 252, 252, ${alpha * 0.4})`;
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, tr.super ? 13 : 9, 0, Math.PI * 2);
      ctx.fill();
    }
    drawVolleyball(match.ball.x, match.ball.y, 13, match.ball.isSuper, frameCount * 0.22);

    ctx.restore(); // Fim do espaço do mundo (camX)

    // 3. Placar Eletrônico Superior (HUD estilo Mega Drive)
    renderMatchHUD();

    // 4. Modal de Substituição (se aberto com TAB / T)
    if (subModalOpen) {
      renderSubstitutionModal();
    }

    ctx.restore();
  }

  function drawRefereeAndLineJudges() {
    // Cadeira do Árbitro no centro-fundo da rede
    ctx.fillStyle = "#6C6C6C";
    ctx.fillRect(NET_X - 18, 225, 36, 145);
    ctx.fillStyle = "#002448";
    ctx.fillRect(NET_X - 12, 200, 24, 30);
    ctx.fillStyle = "#FCB490";
    ctx.fillRect(NET_X - 7, 184, 14, 15);

    // Braço do árbitro sinalizando o ponto
    ctx.strokeStyle = "#FCFCFC";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(NET_X, 206);
    if (match.refereeSignal === "LEFT_POINT") {
      ctx.lineTo(NET_X - 26, 192);
    } else if (match.refereeSignal === "RIGHT_POINT") {
      ctx.lineTo(NET_X + 26, 192);
    } else {
      ctx.lineTo(NET_X + (match.servingSide === 0 ? -20 : 20), 206);
    }
    ctx.stroke();

    // Juízes de linha nas duas extremidades da quadra
    const judgesX = [COURT_LEFT_X - 48, COURT_RIGHT_X + 48];
    for (const jx of judgesX) {
      ctx.fillStyle = "#FCFC00";
      ctx.fillRect(jx - 8, 415, 16, 26);
      ctx.fillStyle = "#FCB490";
      ctx.fillRect(jx - 6, 401, 12, 13);
      // Bandeirinha vermelha (levantada se OUT, apontada para baixo se IN)
      ctx.fillStyle = "#FC0000";
      if (match.lineJudgeState === "OUT") {
        ctx.fillRect(jx + 6, 382, 16, 12);
      } else {
        ctx.fillRect(jx + 8, 422, 14, 10);
      }
    }
  }

  function drawVolleyballNet() {
    // Poste e Antena
    ctx.fillStyle = "#D8D8D8";
    ctx.fillRect(NET_X - 3, NET_TOP_Y, 6, FLOOR_Y - NET_TOP_Y + 12);

    // Fita superior branca da rede
    ctx.fillStyle = "#FCFCFC";
    ctx.fillRect(NET_X - 5, NET_TOP_Y, 10, 8);

    // Malha da rede
    ctx.strokeStyle = "rgba(220, 220, 220, 0.75)";
    ctx.lineWidth = 1;
    for (let y = NET_TOP_Y + 8; y < FLOOR_Y - 28; y += 8) {
      ctx.beginPath();
      ctx.moveTo(NET_X - 4, y);
      ctx.lineTo(NET_X + 4, y);
      ctx.stroke();
    }

    // Antena listrada vermelha e branca
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#FC0000" : "#FCFCFC";
      ctx.fillRect(NET_X - 2, NET_TOP_Y - 24 + i * 4, 4, 4);
    }
  }

  function drawPlayerSprite(p, team, isControlled) {
    const px = Math.round(p.x);
    const py = Math.round(p.y + p.z);

    // Sombra do jogador no piso da quadra
    ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
    ctx.beginPath();
    ctx.ellipse(px, FLOOR_Y + p.z + 2, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Marcador sob o jogador controlado
    if (isControlled) {
      ctx.strokeStyle = p.side === 0 ? "#00FCFC" : "#FCFC00";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(px, FLOOR_Y + p.z + 2, 22, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(px, py);
    if (p.state === "DIVE") {
      ctx.rotate(p.vx >= 0 ? Math.PI * 0.42 : -Math.PI * 0.42);
    }

    // Pernas / Calção (cores da paleta CRAM da seleção)
    ctx.fillStyle = team.secondaryColor || "#0000B4";
    ctx.fillRect(-9, -24, 18, 12);

    // Tênis e meias brancas
    ctx.fillStyle = "#FCB490";
    const legAnim = Math.abs(p.vx) > 0.2 ? Math.sin(frameCount * 0.4) * 5 : 0;
    ctx.fillRect(-8, -12 + legAnim, 6, 10);
    ctx.fillRect(2, -12 - legAnim, 6, 10);
    ctx.fillStyle = "#FCFCFC";
    ctx.fillRect(-9, -4 + legAnim, 8, 4);
    ctx.fillRect(1, -4 - legAnim, 8, 4);

    // Camisa (Jersey) com a cor primária da seleção na ROM
    ctx.fillStyle = team.primaryColor || "#FCFCFC";
    ctx.fillRect(-11, -50, 22, 26);

    // Gola / Detalhe da camisa
    ctx.fillStyle = team.secondaryColor || "#D80000";
    ctx.fillRect(-11, -50, 22, 5);

    // Número da camisa nas costas/peito (extraído da ROM!)
    drawPixelText(String(p.data.number), 0, -32, 12, "#FCFC00", "center", "#000000");

    // Braços (levantados se BLOCK, SPIKE ou TOSS; juntos na frente se RECEIVE)
    ctx.fillStyle = team.skinColor || "#FCB490";
    if (p.state === "BLOCK" || p.state === "SPIKE" || p.state === "TOSS" || p.y < FLOOR_Y - 10) {
      ctx.fillRect(-14, -74, 6, 26);
      ctx.fillRect(8, -74, 6, 26);
    } else if (p.state === "RECEIVE") {
      const dir = p.side === 0 ? 1 : -1;
      ctx.fillRect(dir * 6, -44, dir * 16, 6);
    } else {
      ctx.fillRect(-15, -48, 5, 20);
      ctx.fillRect(10, -48, 5, 20);
    }

    // Cabeça e Cabelo
    ctx.fillStyle = team.skinColor || "#FCB490";
    ctx.fillRect(-8, -66, 16, 15);
    ctx.fillStyle = "#242424";
    ctx.fillRect(-9, -68, 18, 6);

    ctx.restore();

    // Nome do jogador sobre/sob o atleta (opção NAME INDICATION da ROM)
    if (options.nameIndication) {
      drawPixelText(
        p.data.name,
        px,
        FLOOR_Y + p.z + 17,
        11,
        isControlled ? "#FCFC00" : "#FCFCFC",
        "center",
        "#000000"
      );
    }
  }

  function drawVolleyball(x, y, r, isSuper, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.fillStyle = isSuper ? "#FC4824" : "#FCFCFC";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = isSuper ? "#FCFC00" : "#242424";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Gomos clássicos da bola de vôlei
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.7, -0.6, 1.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.85, -r * 0.2);
    ctx.quadraticCurveTo(0, r * 0.4, r * 0.85, -r * 0.2);
    ctx.stroke();

    ctx.restore();
  }

  function renderMatchHUD() {
    const t0 = match.teams[0];
    const t1 = match.teams[1];

    // Placar superior estilo estádio Mega Drive
    ctx.fillStyle = "rgba(0, 12, 28, 0.9)";
    ctx.fillRect(120, 8, W - 240, 62);
    ctx.strokeStyle = "#486CFC";
    ctx.lineWidth = 2;
    ctx.strokeRect(120, 8, W - 240, 62);

    drawFlag(t0.code, 138, 17, 56, 36);
    drawPixelText(t0.code, 206, 43, 26, "#00FCFC", "left");
    drawPixelText(`SETS: ${t0.setsWon}`, 206, 62, 13, "#FCFCFC", "left");

    // Pontuação grande central
    drawPixelText(
      `${String(t0.points).padStart(2, "0")}  -  ${String(t1.points).padStart(2, "0")}`,
      W / 2, 46, 36, "#FCFC00", "center"
    );
    drawPixelText(`SET ${match.currentSet}`, W / 2, 64, 13, "#B4B4B4", "center");

    // Indicador de Saque (SERVICE)
    const srvX = match.servingSide === 0 ? W / 2 - 115 : W / 2 + 115;
    drawVolleyball(srvX, 34, 9, false, frameCount * 0.1);

    drawPixelText(t1.code, W - 206, 43, 26, "#FC6C6C", "right");
    drawPixelText(`SETS: ${t1.setsWon}`, W - 206, 62, 13, "#FCFCFC", "right");
    drawFlag(t1.code, W - 194, 17, 56, 36);

    // Mensagem de chamada do Árbitro / Golpe ("SERVICE!", "IN!", "OUT!", "LIGHTNING SPIKE!", etc.)
    if (match.callTimer > 0 && match.callText) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.78)";
      ctx.fillRect(W / 2 - 190, 82, 380, 52);
      ctx.strokeStyle = "#FCFC00";
      ctx.lineWidth = 2;
      ctx.strokeRect(W / 2 - 190, 82, 380, 52);
      drawPixelText(match.callText, W / 2, 108, 24, "#FCFC00", "center");
      if (match.callSubText) {
        drawPixelText(match.callSubText, W / 2, 127, 14, "#00FCFC", "center");
      }
    }

    // Barra inferior de status tático e atributos da ROM dos jogadores ativos
    ctx.fillStyle = "rgba(0, 10, 24, 0.92)";
    ctx.fillRect(0, H - 44, W, 44);
    ctx.strokeStyle = "#004890";
    ctx.beginPath();
    ctx.moveTo(0, H - 44);
    ctx.lineTo(W, H - 44);
    ctx.stroke();

    const p0Active = t0.courtPlayers[getClosestCourtPlayerIndex(t0, match.ball.targetX)].data;
    const p1Active = t1.courtPlayers[getClosestCourtPlayerIndex(t1, match.ball.targetX)].data;

    drawPixelText(
      `1P #${p0Active.number} ${p0Active.name} [SP:${p0Active.sp} RE:${p0Active.re} SV:${p0Active.sv} BL:${p0Active.bl}]`,
      18, H - 17, 14, "#00FCFC", "left"
    );
    drawPixelText(
      `SET PLAN: ${t0.setPlan} | [TAB] SUBSTITUIR`,
      W / 2, H - 17, 13, "#FCFC00", "center"
    );
    drawPixelText(
      `#${p1Active.number} ${p1Active.name} [SP:${p1Active.sp} RE:${p1Active.re} SV:${p1Active.sv} BL:${p1Active.bl}]`,
      W - 18, H - 17, 14, "#FC6C6C", "right"
    );
  }

  function renderSubstitutionModal() {
    ctx.fillStyle = "rgba(0, 12, 28, 0.94)";
    ctx.fillRect(140, 80, W - 280, H - 160);
    ctx.strokeStyle = "#FCFC00";
    ctx.lineWidth = 3;
    ctx.strokeRect(140, 80, W - 280, H - 160);

    drawPixelText("TEAM MEMBER CHANGE (ROM 0x13B00)", W / 2, 118, 24, "#FCFC00", "center");
    drawPixelText(
      subSelectingBench ? "SELECIONE COM QUEM TROCAR (Z=CONFIRMAR, X=VOLTAR)" : "SELECIONE O JOGADOR EM QUADRA (TAB=FECHAR)",
      W / 2, 145, 14, "#00FCFC", "center"
    );

    const team = match.teams[0];
    for (let i = 0; i < team.fullRoster.length; i++) {
      const p = team.fullRoster[i];
      const y = 180 + i * 32;
      const isSelected = (!subSelectingBench && subCursorCourt === i) || (subSelectingBench && subCursorBench === i);
      ctx.fillStyle = isSelected ? "#900000" : i < 6 ? "rgba(0, 60, 120, 0.6)" : "rgba(40, 40, 40, 0.6)";
      ctx.fillRect(175, y - 18, W - 350, 26);
      const roleTag = i < 6 ? `COURT SLOT ${i + 1}` : "RESERVE BENCH";
      drawPixelText(`${roleTag}: #${String(p.number).padStart(2, "0")} ${p.name}`, 190, y, 15, "#FCFCFC");
      drawPixelText(`SP:${p.sp}  RE:${p.re}  SV:${p.sv}  BL:${p.bl}`, W - 190, y, 15, "#FCFC00", "right");
    }
  }

  // ============================================================================
  // LOOP PRINCIPAL (60 FPS)
  // ============================================================================
  function gameLoop() {
    frameCount++;
    pollGamepad();

    if (gameState === "MATCH") {
      updateMatch();
      renderMatch();
    } else {
      updateMenus();
      if (gameState === "TITLE") renderTitleScreen();
      else if (gameState === "MAIN_MENU") renderMainMenu();
      else if (gameState === "SUB_MENU_1P") renderSubMenu1P();
      else if (gameState === "PASSWORD") renderPasswordScreen();
      else if (gameState === "TEAM_SELECT") renderTeamSelect();
      else if (gameState === "WORLD_LEAGUE_LADDER") renderWorldLeagueLadder();
      else if (gameState === "TEAM_EDIT") renderTeamEdit();
      else if (gameState === "OPTIONS") renderOptions();
      else if (gameState === "SET_SUMMARY") renderSetSummary();
      else if (gameState === "STAFF_ROLL") renderStaffRoll();
    }

    // Limpa justPressed do frame
    for (const k in justPressed) {
      delete justPressed[k];
    }

    requestAnimationFrame(gameLoop);
  }

  // Expor controles de interface para os botões da janela PC
  window.svbControls = {
    resetToTitle: () => {
      gameState = "TITLE";
      window.ymSynth.stopBGM();
    },
    openTeamEdit: () => {
      gameState = "TEAM_EDIT";
      editFieldIdx = 0;
    },
    unlockUrawaza: () => {
      options.unlockedSecret = true;
      window.ymSynth.playSFX("Makyuu3");
    }
  };

  requestAnimationFrame(gameLoop);
})();
