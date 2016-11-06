PP64.adapters = (function() {
  const AdapterBase = class {
    constructor() {
      // The arbitrary upper bound size of the events ASM blob.
      this.EVENT_MEM_SIZE = 0x50000;

      // Location that custom ASM will be placed in RAM.
      this.EVENT_RAM_LOC = (0x80000000 | (0x800000 - this.EVENT_MEM_SIZE)) >>> 0;

      // We reserve a 16 byte header, mainly to allow the ASM hook to be flexible
      // in where it transfers this blob to in RAM.
      this.EVENT_HEADER_SIZE = 16;
    }

    loadBoards() {
      let boards = [];
      let boardInfos = PP64.adapters.boardinfo.getBoardInfos(PP64.romhandler.getROMGame());

      for (let i = 0; i < boardInfos.length; i++) {
        let boardInfo = boardInfos[i];
        let bgDir = boardInfo.bgDir;
        let background = PP64.adapters.hvqfs.readBackground(bgDir);
        let newBoard = {
          "game": this.gameVersion,
          "bg": background,
          "otherbg": {},
        };

        let boardBuffer = PP64.adapters.mainfs.get(this.boardDefDirectory, boardInfo.boardDefFile);
        PP64.adapters.boarddef.parse(boardBuffer, newBoard);
        let chains = newBoard._chains;
        delete newBoard._chains;
        $$log(`Board ${i} chains: `, chains);

        this.onChangeBoardSpaceTypesFromGameSpaceTypes(newBoard);
        this._applyPerspective(newBoard, i);
        this._cleanLoadedBoard(newBoard);

        this.onParseStrings(newBoard, boardInfo);
        if (!newBoard.name)
          newBoard.name = boardInfo.name || "";

        this.onParseBoardSelectImg(newBoard, boardInfo);
        this.onParseBoardLogoImg(newBoard, boardInfo);

        this._parseAudio(newBoard, boardInfo);

        this._extractEvents(boardInfo, newBoard, i, chains);
        this._extractStarGuardians(newBoard, boardInfo);
        this._extractBoos(newBoard, boardInfo);

        if (boardInfo.onLoad)
          boardInfo.onLoad(newBoard);

        if (this.onLoad)
          this.onLoad(newBoard, boardInfo);

        boards.push(newBoard);
      }

      if ($$debug) {
        // Debug if audio offsets are right.
        let audioSectionCount = PP64.adapters.audio.getPatchInfo().length;
        for (let i = 0; i < audioSectionCount; i++)
          PP64.adapters.audio.getROMOffset(i);
      }

      return boards;
    }

    overwriteBoard(boardIndex, board) {
      let boardCopy = PP64.utils.obj.copy(board);
      let boardInfo = PP64.adapters.boardinfo.getBoardInfos(PP64.romhandler.getROMGame())[boardIndex];

      let chains = PP64.adapters.boarddef.determineChains(boardCopy);
      PP64.adapters.boarddef.padChains(boardCopy, chains);

      // If the user didn't place enough 3d characters, banish them to this dead space off screen.
      let deadSpace = PP64.boards.addSpace(boardCopy.bg.width + 150, boardCopy.bg.height + 100, $spaceType.OTHER, undefined, boardCopy);
      boardCopy._deadSpace = deadSpace;

      this.onChangeGameSpaceTypesFromBoardSpaceTypes(boardCopy);
      this._reversePerspective(boardCopy, boardIndex);

      let boarddef = PP64.adapters.boarddef.create(boardCopy, chains);
      PP64.adapters.mainfs.write(this.boardDefDirectory, boardInfo.boardDefFile, boarddef);

      // Wipe out the space event definition array.
      // let spaceEventStart = boardInfo.spaceEventsStartOffset;
      // let spaceEventEnd = boardInfo.spaceEventsEndOffset;
      let romView = PP64.romhandler.getDataView();
      // for (let offset = spaceEventStart; offset < spaceEventEnd; offset += 4)
      //   romView.setUint32(offset, 0xFFFF0000);

      // Wipe out the event ASM from those events.
      let eventASMStart = boardInfo.eventASMStart;
      if (eventASMStart) {
        let eventASMEnd = boardInfo.eventASMEnd;
        for (let offset = eventASMStart; offset < eventASMEnd; offset += 4)
          romView.setUint32(offset, 0);
      }

      this.onWriteStrings(boardCopy, boardInfo);
      this.onWriteAudio(boardCopy, boardInfo, boardIndex);

      // Write out the board events to ROM.
      this.onCreateChainEvents(boardCopy, chains);
      this._createStarEvents(boardCopy);
      if (boardInfo.onWriteEvents)
        boardInfo.onWriteEvents(boardCopy);
      this._writeEvents(boardCopy, boardInfo, boardIndex);
      this._writeStarInfo(boardCopy, boardInfo);
      this._writeBoos(boardCopy, boardInfo);

      this._clearOtherBoardNames(boardIndex);

      if (boardInfo.onAfterOverwrite)
        boardInfo.onAfterOverwrite(romView, boardCopy);

      if (this.onAfterOverwrite)
        this.onAfterOverwrite(romView, boardCopy, boardInfo);

      return this.onOverwritePromises(board, boardInfo);
    }

    onOverwritePromises(board, boardInfo) {
      $$log("Adapter does not implement onOverwritePromises");
    }

    // Gives a new space the default things it would need.
    hydrateSpace(space) {
      throw "hydrateSpace not implemented";
    }

    onParseStrings(board, boardInfo) {
      $$log("Adapter does not implement onParseStrings");
    }

    onWriteStrings(board, boardInfo) {
      $$log("Adapter does not implement onWriteStrings");
    }

    _applyPerspective(board, boardIndex) {
      let width = board.bg.width;
      let height = board.bg.height;

      for (let spaceIdx = 0; spaceIdx < board.spaces.length; spaceIdx++) {
        let space = board.spaces[spaceIdx];
        [space.x, space.y, space.z] = this.onGetBoardCoordsFromGameCoords(space.x, space.y, space.z, width, height, boardIndex);
      }
    }

    onGetBoardCoordsFromGameCoords(x, y, z, width, height, boardIndex) {
      $$log("Adapter does not implement onGetBoardCoordsFromGameCoords");
      let newX = (width / 2) + x;
      let newY = (height / 2) + y;
      let newZ = 0;
      return [Math.round(newX), Math.round(newY), Math.round(newZ)];
    }

    _reversePerspective(board, boardIndex) {
      let width = board.bg.width;
      let height = board.bg.height;

      for (let spaceIdx = 0; spaceIdx < board.spaces.length; spaceIdx++) {
        let space = board.spaces[spaceIdx];
        [space.x, space.y, space.z] = this.onGetGameCoordsFromBoardCoords(space.x, space.y, space.z, width, height, boardIndex);
      }
    }

    onGetGameCoordsFromBoardCoords(x, y, z, width, height, boardIndex) {
      $$log("Adapter does not implement onGetGameCoordsFromBoardCoords");
      let gameX = x - (width / 2);
      let gameY = y - (height / 2);
      let gameZ = 0.048;
      return [gameX, gameY, gameZ];
    }

    // if ($$debug) { // These need to be proper inverses
    //   try {
    //     for (let boardIndex = 0; boardIndex < 9; boardIndex++) {
    //       let [beforeX, beforeY, beforeZ] = [-200, -200, 0];
    //       let [boardX, boardY, boardZ] = this.onGetBoardCoordsFromGameCoords(beforeX, beforeY, beforeZ, 960, 720, boardIndex);
    //       let [afterX, afterY, afterZ] = this.onGetGameCoordsFromBoardCoords(boardX, boardY, boardZ, 960, 720, boardIndex);
    //       if (beforeX !== afterX)
    //         $$log(`Bad X inverse, boardIndex: ${boardIndex}, beforeX: ${beforeX}, afterX: ${afterX}`);
    //       if (beforeY !== afterY)
    //         $$log(`Bad Y inverse, boardIndex: ${boardIndex}, beforeY: ${beforeY}, afterY: ${afterY}`);
    //     }
    //   } catch(e) {}
    // }

    onChangeBoardSpaceTypesFromGameSpaceTypes(board) {
      $$log("Adapter does not implement onChangeBoardSpaceTypesFromGameSpaceTypes");
    }

    onChangeGameSpaceTypesFromBoardSpaceTypes(board) {
      $$log("Adapter does not implement onChangeGameSpaceTypesFromBoardSpaceTypes");
    }

    // Assumes the board event data region.
    _offsetToAddr(offset, boardInfo) {
      return boardInfo.spaceEventsStartAddr
          - (boardInfo.spaceEventsStartOffset - offset);
    }

    _offsetToAddrBase(offset, base) {
      return (base + offset) >>> 0;
    }

    // Assumes the board event data region.
    _addrToOffset(addr, boardInfo) {
      return boardInfo.spaceEventsStartOffset
          - (boardInfo.spaceEventsStartAddr - addr);
    }

    _addrToOffsetBase(addr, base) {
      return ((addr & 0x7FFFFFFF) - (base & 0x7FFFFFFF)) >>> 0;
    }

    // Handles any _deadSpace we may have added in overwriteBoard
    _cleanLoadedBoard(board) {
      let lastIdx = board.spaces.length - 1;
      let lastSpace = board.spaces[board.spaces.length - 1];
      if (lastSpace && (lastSpace.x > board.bg.width + 50) && (lastSpace.y > board.bg.height + 50)) {
        $$log("Pruning dead space", lastSpace);
        board.spaces.splice(lastIdx, 1);
      }
    }

    _extractEvents(boardInfo, board, boardIndex, chains) {
      if (boardInfo.spaceEventTables) {
        this._extractEventsNew(boardInfo, board, boardIndex, chains);
        return;
      }

      // When we convert everything to spaceEventTables, just remove this and rename _extractEventsNew
      if (!boardInfo.spaceEventsStartAddr)
        return;

      let buffer = PP64.romhandler.getROMBuffer();
      let boardView = new DataView(buffer);
      let curOffset = boardInfo.spaceEventsStartOffset;

      // Generic events
      while (curOffset < boardInfo.spaceEventsEndOffset) {
        if (boardView.getInt16(curOffset) === -1) { // Sometimes there's -1 dividers.
          curOffset += 8;
          continue;
        }

        // Figure out the current info struct offset in the ROM.
        let curInfoAddr = boardView.getUint32(curOffset + 4) & 0x7FFFFFFF;
        let curInfoOffset = this._addrToOffset(curInfoAddr, boardInfo);
        let eventActivationType = boardView.getUint16(curInfoOffset);

        if (!curInfoAddr && !boardView.getInt16(curOffset)) // Just ran out of events and into 00s.
          break;

        while (eventActivationType) {
          // Figure out the event ASM info in ROM.
          let mystery2 = boardView.getUint16(curInfoOffset + 2);
          let asmAddr = boardView.getUint32(curInfoOffset + 4) & 0x7FFFFFFF;
          let asmOffset = boardInfo.spaceEventsStartOffset
            - (boardInfo.spaceEventsStartAddr - asmAddr);

          let curSpace = boardView.getInt16(curOffset);
          let eventInfo = PP64.adapters.events.parse(boardView, {
            addr: asmAddr,
            offset: asmOffset,
            board,
            boardIndex,
            curSpace,
            chains,
            game: PP64.romhandler.getROMGame(),
            gameVersion: this.gameVersion,
          });

          // We parsed an actual event.
          if (eventInfo && eventInfo !== true) {
            eventInfo.activationType = eventActivationType;
            eventInfo.mystery = mystery2;
            PP64.boards.addEventByIndex(board, curSpace, eventInfo);

            //console.log(`Found event 0x${asmOffset.toString(16)} (${eventInfo.name})`);
          }
          else if (!eventInfo) {
            //console.log(`Unknown event 0x${asmOffset.toString(16)} on board ${boardIndex} (${boardInfo.name})`);
          }

          curInfoAddr += 8;
          curInfoOffset = this._addrToOffset(curInfoAddr, boardInfo);
          eventActivationType = boardView.getUint16(curInfoOffset);
        }

        curOffset += 8;
      }
    }

    _extractEventsNew(boardInfo, board, boardIndex, chains) {
      if (!boardInfo.spaceEventTables)
        return;

      // PP64 sometimes stores board ASM in the main filesystem. We need to
      // be able to parse both that or the stock boards.
      let buffer, bufferView, spaceTableInfo;
      let eventTable = new PP64.adapters.SpaceEventTable();
      if (boardInfo.mainfsEventFile) {
        let [mainFsDir, mainFsFile] = boardInfo.mainfsEventFile;
        if (PP64.adapters.mainfs.has(mainFsDir, mainFsFile)) {
          buffer = PP64.adapters.mainfs.get(mainFsDir, mainFsFile);
          bufferView = new DataView(buffer);

          eventTable.parse(buffer, 0x10); // TODO: Multi-table.
        }
      }

      if (!buffer) {
        buffer = PP64.romhandler.getROMBuffer();
        bufferView = PP64.romhandler.getDataView();

        boardInfo.spaceEventTables.forEach(tableDeflateCall => {
          // Each board can have several event tables, which it "deflates" by
          // passing the table address to some function. We are parsing the table
          // addresses from those calls, because that gives us the flexibility
          // to reposition the tables and find them again later.
          let upper = bufferView.getUint32(tableDeflateCall.upper);
          let lower = bufferView.getUint32(tableDeflateCall.lower);
          if (!upper && !lower)
            return;
          let tableAddr = $MIPS.getRegSetAddress(upper, lower);
          let tableOffset = this._addrToOffset(tableAddr, boardInfo);

          eventTable.parse(buffer, tableOffset); // Build up all the events into one collection.
        });
      }

      eventTable.forEach(eventTableEntry => {
        let curSpaceIndex = eventTableEntry.spaceIndex;

        // Figure out the current info struct offset in the ROM.
        let curInfoAddr = eventTableEntry.address & 0x7FFFFFFF;
        let curInfoOffset;
        if (curInfoAddr > (this.EVENT_RAM_LOC & 0x7FFFFFFF))
          curInfoOffset = this._addrToOffsetBase(curInfoAddr, this.EVENT_RAM_LOC);
        else
          curInfoOffset = this._addrToOffset(curInfoAddr, boardInfo);
        let boardList = new PP64.adapters.SpaceEventList();
        boardList.parse(buffer, curInfoOffset);
        boardList.forEach(listEntry => {
          // Figure out the event ASM info in ROM.
          let asmAddr = listEntry.address & 0x7FFFFFFF;
          let asmOffset, codeView;
          if (asmAddr > (this.EVENT_RAM_LOC & 0x7FFFFFFF)) {
            asmOffset = this._addrToOffsetBase(asmAddr, this.EVENT_RAM_LOC);
            codeView = bufferView;
          }
          else {
            // This event actually points back to the original ROM.
            asmOffset = this._addrToOffset(asmAddr, boardInfo);
            codeView = PP64.romhandler.getDataView();
          }

          let eventInfo = PP64.adapters.events.parse(codeView, {
            addr: asmAddr,
            offset: asmOffset,
            board,
            boardIndex,
            curSpace: curSpaceIndex,
            chains,
            game: PP64.romhandler.getROMGame(),
            gameVersion: this.gameVersion,
          });

          // We parsed an actual event.
          if (eventInfo && eventInfo !== true) {
            eventInfo.activationType = listEntry.activationType;
            eventInfo.mystery = listEntry.mystery;
            PP64.boards.addEventByIndex(board, curSpaceIndex, eventInfo);

            //console.log(`Found event 0x${asmOffset.toString(16)} (${eventInfo.name})`);
          }
          else if (!eventInfo) {
            //console.log(`Unknown event 0x${asmOffset.toString(16)} on board ${boardIndex} (${boardInfo.name})`);
          }

          if ($$debug) {
            if (Object.values($activationType).indexOf(listEntry.activationType) === -1)
              $$log(`Unknown event activation type ${$$hex(listEntry.activationType)}, boardIndex: ${boardIndex}, spaceIndex: ${$$hex(curSpaceIndex)}`);
          }
        });
      });
    }

    // Creates the chain-based event objects that we abstract out in the UI.
    onCreateChainEvents(board, chains) {
      // There is either a merge or a split at the end of each chain.
      for (let i = 0; i < chains.length; i++) {
        let chain = chains[i];
        let lastSpace = chain[chain.length - 1];
        let links = board.links[lastSpace];
        if (!Array.isArray(links))
          links = [links];
        let event;
        if (links.length > 1) {
          // A split, figure out the end points.
          let endpoints = [];
          links.forEach(link => {
            endpoints.push(_getChainWithSpace(link));
          });
          event = PP64.adapters.events.create("CHAINSPLIT", {
            args: { inline: links.concat(0xFFFF) },
            chains: endpoints,
          });
        }
        else {
          event = PP64.adapters.events.create("CHAINMERGE", {
            chain: _getChainWithSpace(links[0]),
          });
        }

        PP64.boards.addEventByIndex(board, lastSpace, event, true);
      }

      function _getChainWithSpace(space) {
        for (let c = 0; c < chains.length; c++) {
          if (chains[c].indexOf(space) >= 0) // Should really be 0 always - game does support supplied index other than 0 though.
            return c;
        }
      }
    }

    // Adds the star events we abstract in the UI.
    _createStarEvents(board) {
      // There is either a merge or a split at the end of each chain.
      for (let i = 0; i < board.spaces.length; i++) {
        let space = board.spaces[i];
        if (!space || !space.star)
          continue;
        let events = space.events || [];
        let hasStarEvent = events.some(e => { e.id === "STAR" }); // Pretty unlikely
        if (!hasStarEvent)
          PP64.boards.addEventToSpace(space, PP64.adapters.events.create("STAR"));
      }
    }

    _getArgsSize(count) {
      return (count * 2) + (4 - ((count * 2) % 4));
    }

    // Write out all of the events ASM.
    _writeEvents(board, boardInfo, boardIndex) {
      if (boardInfo.mainfsEventFile) {
        this._writeEventsNew(board, boardInfo, boardIndex);
        return;
      }

      let romView = PP64.romhandler.getDataView();
      let romBytes = PP64.romhandler.getByteArray();

      let curEventListingOffset = boardInfo.spaceEventsStartOffset;
      let curEventRedirectOffset = curEventListingOffset - 8; // This moves backwards.
      let curASMOffset = boardInfo.eventASMStart;

      romBytes.fill(0, curEventRedirectOffset, curEventRedirectOffset + 8); // Pad zeros between the two sections.

      let eventTemp = {};
      let sharedAddrs = {};

      for (let i = 0; i < board.spaces.length; i++) {
        let space = board.spaces[i];
        if (!space.events || !space.events.length)
          continue;

        // Prepare the redirection area.
        let redirEntryLen = (space.events.length + 1) * 8;
        space.events.forEach(event => {
          if (event.args && event.args.inline) {
            redirEntryLen += this._getArgsSize(event.args.inline.length);
          }
        });
        curEventRedirectOffset -= redirEntryLen;
        romBytes.fill(0, curEventRedirectOffset, curEventRedirectOffset + redirEntryLen);

        // Reads entries first to last, but leave empty zeroes in front.
        let redirEntry = curEventRedirectOffset + 8;

        let hasWrittenListingOffset = false;

        space.events.forEach(event => {
          let temp = eventTemp[event.id] || {};
          let info = {
            boardIndex,
            offset: curASMOffset,
            addr: this._offsetToAddr(curASMOffset, boardInfo) | 0x80000000,
            game: PP64.romhandler.getROMGame(),
            gameVersion: this.gameVersion,
          };

          // Write any inline arguments
          let argsCount = 0;
          let argsSize = 0;
          if (event.args && event.args.inline) {
            argsCount = event.args.inline.length;
            argsSize = this._getArgsSize(argsCount);
            info.argsAddr = this._offsetToAddr(redirEntry, boardInfo) | 0x80000000;
          }
          for (let arg = 0; arg < argsCount; arg++) {
            let argOffset = redirEntry + (arg * 2);
            romView.setUint16(argOffset, event.args.inline[arg]);
          }

          let [writtenASMOffset, len] = PP64.adapters.events.write(PP64.romhandler.getROMBuffer(), event, info, temp);
          eventTemp[event.id] = temp;

          romView.setUint16(argsSize + redirEntry, event.activationType);
          romView.setUint16(argsSize + redirEntry + 2, event.mystery);
          romView.setUint32(argsSize + redirEntry + 4, this._offsetToAddr(writtenASMOffset, boardInfo) | 0x80000000);

          if (!hasWrittenListingOffset) {
            // Write the event listing for this space once we know the args size.
            romView.setUint16(curEventListingOffset, i); // Space index
            romView.setUint32(curEventListingOffset + 4, this._offsetToAddr(argsSize + redirEntry, boardInfo) | 0x80000000); // Redirect addr

            hasWrittenListingOffset = true;
          }

          redirEntry += 8 + argsSize;

          // If we actually wrote to the new space, update curASMOffset, else assume we reused some ASM.
          if (writtenASMOffset === curASMOffset)
            curASMOffset += len;

          if (curASMOffset > boardInfo.eventASMEnd) {
            PP64.app.showMessage(`Oops! This board is too complicated and overflowed the game's available space.
              Try removing some events or reducing the number of branching paths.
              The ROM has also been corrupted in memory so please close and open it.`); // '
            throw "Overflowed board event ASM region.";
          }
        });

        curEventListingOffset += 8;
      }
    }

    _writeEventsNew(board, boardInfo, boardIndex) {
      if (!boardInfo.mainfsEventFile)
        throw `No MainFS file specified to place board ASM for board ${boardIndex}.`;

      // We will make the buffer maximum size, but will shrink it later to what it actually needs to be.
      let eventBuffer = new ArrayBuffer(this.EVENT_MEM_SIZE);
      let eventView = new DataView(eventBuffer);

      let currentOffset = this.EVENT_HEADER_SIZE;

      eventView.setUint32(0, PP64.utils.string.toU32("PP64"));
      eventView.setUint32(4, this.EVENT_RAM_LOC);

      // Create hollow structures for the table and lists to figure out how big they will be.
      let eventTable = new PP64.adapters.SpaceEventTable();
      let eventLists = [];

      for (let i = 0; i < board.spaces.length; i++) {
        let space = board.spaces[i];
        if (!space.events || !space.events.length)
          continue;
        eventTable.add(i, 0); // Just to keep track of what the table size is, address will be added later.

        let eventList = new PP64.adapters.SpaceEventList();
        for (let e = 0; e < space.events.length; e++) {
          let event = space.events[e];
          eventList.add(event.activationType, event.mystery, 0); // Also to track size
        }
        eventLists.push(eventList);
      }

      // Figure out size of table and lists
      let tableSize = $$number.makeDivisibleBy(eventTable.byteLength(), 16);

      let listsSize = eventLists.reduce((sum, list) => {
        return sum + list.byteLength();
      }, 0);
      listsSize = $$number.makeDivisibleBy(listsSize, 16);

      currentOffset += tableSize + listsSize;

      // Now we know where to start writing the ASM event code.
      // As we go along, we can go back and fill in the space and event lists.
      let eventTemp = {};
      let sharedAddrs = {};
      let eventListIndex = 0;
      let eventListCurrentOffset = this.EVENT_HEADER_SIZE + tableSize;
      for (let i = 0; i < board.spaces.length; i++) {
        let space = board.spaces[i];
        if (!space.events || !space.events.length)
          continue;

        let eventList = eventLists[eventListIndex];
        for (let e = 0; e < space.events.length; e++) {
          let event = space.events[e];
          let temp = eventTemp[event.id] || {};
          let info = {
            boardIndex,
            board,
            curSpaceIndex: i,
            curSpace: space,
            offset: currentOffset,
            addr: this._offsetToAddrBase(currentOffset, this.EVENT_RAM_LOC),
            game: PP64.romhandler.getROMGame(),
            gameVersion: this.gameVersion,
          };

          let [writtenOffset, len] = PP64.adapters.events.write(eventBuffer, event, info, temp);
          eventTemp[event.id] = temp;

          // Apply address to event list.
          // If the writtenOffset is way out of bounds (like > EVENT_MEM_SIZE)
          // it probably means it is directly referencing old code (some 2/3
          // events are like this for now) so we need to calc differently.
          let eventListAsmAddr;
          if (writtenOffset > this.EVENT_MEM_SIZE)
            eventListAsmAddr = this._offsetToAddr(writtenOffset, boardInfo) | 0x80000000;
          else
            eventListAsmAddr = this._offsetToAddrBase(writtenOffset, this.EVENT_RAM_LOC);
          eventList.setAddress(e, eventListAsmAddr);

          currentOffset += len;
        }

        // We can fill in the address of the event listing itself back into the
        // event table (not related to the e loop above, but saves having
        // to loop on spaces again.)
        let eventListAddr = this._offsetToAddrBase(eventListCurrentOffset, this.EVENT_RAM_LOC);
        eventTable.add(i, eventListAddr);

        eventListCurrentOffset += eventList.write(eventBuffer, eventListCurrentOffset);

        eventListIndex++;
      }

      // Now we can write the event table, because all the addresses are set.
      eventTable.write(eventBuffer, this.EVENT_HEADER_SIZE);

      // We can write the size of the event buffer to the header now, for the hook to use.
      eventView.setUint32(8, currentOffset);

      // Shrink the buffer to what was actually needed
      eventBuffer = eventBuffer.slice(0, currentOffset);

      // We write list blob of ASM/structures into the MainFS, in a location
      // that is not used by the game.
      let [mainFsDir, mainFsFile] = boardInfo.mainfsEventFile;
      PP64.adapters.mainfs.write(mainFsDir, mainFsFile, eventBuffer);

      //saveAs(new Blob([eventBuffer]), "eventBuffer");

      // TODO: Write the hook
      this._writeEventAsmHook(boardInfo, boardIndex);
    }

    _writeEventAsmHook(boardInfo, boardIndex) {
      // The hook logic will be placed at the top of eventASMStart, since
      // we don't put anything there much anymore.
      let hookAddr = this._offsetToAddr(boardInfo.eventASMStart, boardInfo);
      let hookJAL = $MIPS.makeInst("JAL", hookAddr);

      let romView = PP64.romhandler.getDataView();

      // Clear the space event table hydrations, because we want a NOP sled
      // through the old logic basically, and no hook interference.
      this._clearSpaceEventTableCalls(romView, boardInfo);

      // We will JAL to the eventASMStart location from the location where the
      // board data is hydrated.
      let hookOffset = boardInfo.spaceEventTables[0].upper;
      romView.setUint32(hookOffset, hookJAL);

      $$log(`Installed event hook at ROM ${$$hex(hookOffset)}, JAL ${hookAddr}`);

      //this.onWriteEventAsmHook(romView, boardInfo, boardIndex);
      // We essentially repeat the logic that all the boards use to hydrate the
      // MainFS code blob (and bring the blob into RAM of course.)
      let offset = boardInfo.eventASMStart;

      // Set up the stack (this is a legit function call)
      romView.setUint32(offset, $MIPS.makeInst("ADDIU", $MIPS.REG.SP, $MIPS.REG.SP, 0xFFE8)); // ADDIU SP, SP, 0xFFE8
      romView.setUint32(offset += 4, $MIPS.makeInst("SW", $MIPS.REG.RA, $MIPS.REG.SP, 0x0010)); // SW RA, 0x0010(SP)

      // Call for the MainFS to read in the ASM blob.
      let [mainFsDir, mainFsFile] = boardInfo.mainfsEventFile;
      romView.setUint32(offset += 4, $MIPS.makeInst("LUI", $MIPS.REG.A0, mainFsDir)); // LW A0, [The dir index]
      romView.setUint32(offset += 4, $MIPS.makeInst("JAL", this.MAINFS_READ_ADDR)); // JAL MainFSRead
      romView.setUint32(offset += 4, $MIPS.makeInst("ADDIU", $MIPS.REG.A0, $MIPS.REG.A0, mainFsFile)); // ADDIU A0, A0, [The file index]

      // Now, V0 has the location that the MainFSRead put the blob... it isn't
      // where we want it, it is in the heap somewhere, so we will move it.

      // This is a pretty simple copy loop
      // T4 = Copy of V0, Current source RAM location
      // T0 = Current dest RAM location
      // T1 = Size of buffer remaining to copy
      // T2 = Temp word register to do the copy
      romView.setUint32(offset += 4, $MIPS.makeInst("ADDU", $MIPS.REG.T4, $MIPS.REG.V0, $MIPS.REG.R0)); // Copy V0 -> T4
      romView.setUint32(offset += 4, $MIPS.makeInst("LW", $MIPS.REG.T0, $MIPS.REG.T4, 0x0004)); // LW T0, 0x4(T4) [RAM dest]
      romView.setUint32(offset += 4, $MIPS.makeInst("LW", $MIPS.REG.T1, $MIPS.REG.T4, 0x0008)); // LW T1, 0x8(T4) [Buffer size]
      // Loop start:
      romView.setUint32(offset += 4, $MIPS.makeInst("LW", $MIPS.REG.T2, $MIPS.REG.T4, 0)); // LW T2, 0x0(T4)
      romView.setUint32(offset += 4, $MIPS.makeInst("SW", $MIPS.REG.T2, $MIPS.REG.T0, 0)); // SW T2, 0x0(T0)
      romView.setUint32(offset += 4, $MIPS.makeInst("ADDIU", $MIPS.REG.T4, $MIPS.REG.T4, 4)); // ADDIU T4, T4, 4
      romView.setUint32(offset += 4, $MIPS.makeInst("ADDIU", $MIPS.REG.T0, $MIPS.REG.T0, 4)); // ADDIU T0, T0, 4
      romView.setUint32(offset += 4, $MIPS.makeInst("ADDIU", $MIPS.REG.T1, $MIPS.REG.T1, 0xFFFC)); // ADDIU T1, T1, -4
      romView.setUint32(offset += 4, $MIPS.makeInst("BGTZ", $MIPS.REG.T1, 0xFFFFFFE8)); // BGTZ T1, -5 instructions
      romView.setUint32(offset += 4, 0); // NOP

      // Now we can hydrate the table.
      // T9 = V0 copy (least likely to be overwritten by an uncontrolled JAL)
      // T4 = Dest buffer addr + 0x10, where the table really starts
      romView.setUint32(offset += 4, $MIPS.makeInst("ADDU", $MIPS.REG.T9, $MIPS.REG.V0, $MIPS.REG.R0)); // Copy V0 -> T9
      romView.setUint32(offset += 4, $MIPS.makeInst("LW", $MIPS.REG.T4, $MIPS.REG.T9, 0x0004)); // LW T4, 0x4(T9) [RAM dest]
      romView.setUint32(offset += 4, $MIPS.makeInst("JAL", this.TABLE_HYDRATE_ADDR)); // JAL TableHydrate
      romView.setUint32(offset += 4, $MIPS.makeInst("ADDIU", $MIPS.REG.A0, $MIPS.REG.T4, 0x10)); // ADDIU A0, T4, 16

      // Well, we copied the buffer... now we should "free" it with this magic JAL...
      // Free our T9 reference, which theoretically could be corrupted, but in practice not.
      romView.setUint32(offset += 4, $MIPS.makeInst("JAL", this.HEAP_FREE_ADDR)); // JAL HeapFree
      romView.setUint32(offset += 4, $MIPS.makeInst("ADDU", $MIPS.REG.A0, $MIPS.REG.T9, $MIPS.REG.R0)); // ADDIU A0, T9, R0

      // End the call stack
      romView.setUint32(offset += 4, $MIPS.makeInst("LW", $MIPS.REG.RA, $MIPS.REG.SP, 0x0010)); // LW RA, 0x0010(SP)
      romView.setUint32(offset += 4, $MIPS.makeInst("JR", $MIPS.REG.RA)); // JR RA
      romView.setUint32(offset += 4, $MIPS.makeInst("ADDIU", $MIPS.REG.SP, $MIPS.REG.SP, 0x0018)); // ADDIU SP, SP, 0x0018
    }

    _clearSpaceEventTableCalls(romView, boardInfo) {
      // The BoardInfo might have special logic.
      if (boardInfo.clearSpaceEventTableCalls) {
        boardInfo.clearSpaceEventTableCalls(romView);
        return;
      }

      // Otherwise, we can probably just clear all memory between the upper and
      // lower for each table.
      let tables = boardInfo.spaceEventTables;
      tables.forEach(tableInfo => {
        for (let offset = tableInfo.upper; offset <= tableInfo.lower; offset += 4)
          romView.setUint32(offset, 0);
      });
    }

    onWriteEventAsmHook(boardInfo, boardIndex) {
      throw "Adapter does not implement onWriteEventAsmHook";
    }

    _extractStarGuardians(board, boardInfo) { // AKA Toads or Baby Bowsers lol
      let boardView = new DataView(PP64.romhandler.getROMBuffer());

      // Training writes the toad directly.
      if (boardInfo.toadSpaceInst) {
        let toadSpace = boardView.getUint16(boardInfo.toadSpaceInst + 2);
        if (board.spaces[toadSpace])
          board.spaces[toadSpace].subtype = $spaceSubType.TOAD;
      }

      if (boardInfo.starSpaceCount) {
        // Parse the spaces that can be considered for star placement.
        let starSpacesOffset = boardInfo.starSpaceArrOffset;
        if (Array.isArray(starSpacesOffset))
          starSpacesOffset = starSpacesOffset[0];
        for (let i = 0; i < boardInfo.starSpaceCount; i++) {
          let starSpace = boardView.getUint16(starSpacesOffset + (i * 2));
          if (board.spaces[starSpace]) {
            board.spaces[starSpace].star = true;
          }
        }

        // Parse the associated toads
        for (let i = 0; i < boardInfo.starSpaceCount; i++) {
          let toadSpacesOffset = boardInfo.toadSpaceArrOffset;
          if (Array.isArray(toadSpacesOffset))
            toadSpacesOffset = toadSpacesOffset[0];
          let toadSpace = boardView.getUint16(toadSpacesOffset + (i * 2));
          if (board.spaces[toadSpace])
            board.spaces[toadSpace].subtype = $spaceSubType.TOAD;
        }
      }
    }

    _writeStarInfo(board, boardInfo) {
      let starCount = boardInfo.starSpaceCount;
      if (starCount) {
        let romView = PP64.romhandler.getDataView();

        let starIndices = [];
        for (let i = 0; i < board.spaces.length; i++) {
          if (board.spaces[i].star)
            starIndices.push(i);
        }

        let starSpacesOffsets = boardInfo.starSpaceArrOffset;
        if (!Array.isArray(starSpacesOffsets))
          starSpacesOffsets = [starSpacesOffsets];
        for (let i = 0; i < starSpacesOffsets.length; i++) {
          let offset = starSpacesOffsets[i];
          for (let j = 0; j < starCount; j++) {
            let starIdx = (j < starIndices.length ? j : starIndices.length - 1); // Keep writing last space to fill
            romView.setUint16(offset + (j * 2), starIndices[starIdx]);
          }
        }

        let toadSpaces = PP64.boards.getSpacesOfSubType($spaceSubType.TOAD, board);

        // Write the toad spaces, using distance formula for now.
        let toadSpacesOffsets = boardInfo.toadSpaceArrOffset;
        if (!Array.isArray(toadSpacesOffsets))
          toadSpacesOffsets = [toadSpacesOffsets];
        for (let i = 0; i < toadSpacesOffsets.length; i++) {
          let offset = toadSpacesOffsets[i];
          for (let j = 0; j < starCount; j++) {
            let starIdx = (j < starIndices.length ? j : starIndices.length - 1);
            let starSpace = board.spaces[starIndices[starIdx]];
            let bestDistance = Number.MAX_VALUE;
            let bestToadIdx = starIndices[starIdx]; // By default, no toad spaces = put toad on star space for now.
            for (let t = 0; t < toadSpaces.length; t++) {
              let toadIdx = toadSpaces[t];
              let toadSpace = board.spaces[toadIdx];
              let dist = PP64.utils.number.distance(starSpace.x, starSpace.y, toadSpace.x, toadSpace.y);
              if (dist < bestDistance) {
                bestDistance = dist;
                bestToadIdx = toadIdx;
              }
            }

            romView.setUint16(offset + (j * 2), bestToadIdx);
          }
        }
      }
    }

    _extractBoos(board, boardInfo) {
      let boardView = PP64.romhandler.getDataView();
      let booSpace;
      if (boardInfo.boosLoopFnOffset) {
        let booFnOffset = boardInfo.boosLoopFnOffset;

        // Read the Boo count.
        let booCount = boardView.getUint16(booFnOffset + 0x2A);
        if (boardView.getUint32(booFnOffset + 0x28) === 0x1A00FFFC) // BNEZ when a single boo is made (Wario)
          booCount = 1;
        if (booCount === 0)
          return;

        booFnOffset = boardInfo.boosReadbackFnOffset;
        let booRelativeAddr = boardView.getInt16(booFnOffset + 0xD2);
        booRelativeAddr = 0x00100000 + booRelativeAddr; // Going to be a subtraction.

        // Assuming this is less than the space events.
        let booSpacesOffset = boardInfo.spaceEventsStartOffset
          - (boardInfo.spaceEventsStartAddr - booRelativeAddr);

        for (let i = 0; i < booCount; i++) {
          booSpace = boardView.getUint16(booSpacesOffset + (2 * i));
          if (board.spaces[booSpace])
            board.spaces[booSpace].subtype = $spaceSubType.BOO;
        }
      }
      else if (boardInfo.booSpaceInst) { // Just one Boo
        booSpace = boardView.getUint16(boardInfo.booSpaceInst + 2);
        if (board.spaces[booSpace])
          board.spaces[booSpace].subtype = $spaceSubType.BOO;
      }
      else if (boardInfo.booCount) {
        for (let b = 0; b < boardInfo.booArrOffset.length; b++) {
          let curBooSpaceIndexOffset = boardInfo.booArrOffset[b];
          for (let i = 0; i < boardInfo.booCount; i++) {
            let booSpace = boardView.getUint16(curBooSpaceIndexOffset);
            if (board.spaces[booSpace])
              board.spaces[booSpace].subtype = $spaceSubType.BOO;
            curBooSpaceIndexOffset += 2;
          }
        }
      }
    }

    _writeBoos(board, boardInfo) {
      // Find the boo spaces
      let booSpaces = PP64.boards.getSpacesOfSubType($spaceSubType.BOO, board);

      let boardView = PP64.romhandler.getDataView();
      if (boardInfo.boosLoopFnOffset) {
        let booFnOffset = boardInfo.boosLoopFnOffset;

        // Read the Boo count.
        let booCount = boardView.getUint16(booFnOffset + 0x2A);
        if (boardView.getUint32(booFnOffset + 0x28) === 0x1A00FFFC) // BNEZ when a single boo is made (Wario)
          booCount = 1;
        else if (booSpaces.length && booCount > booSpaces.length) {
          // Basically lower the boo count if we only have 1 boo instead of 2.
          boardView.setUint16(booFnOffset + 0x2A, booSpaces.length);
        }
        if (booCount === 0)
          return;

        booFnOffset = boardInfo.boosReadbackFnOffset;
        let booRelativeAddr = boardView.getInt16(booFnOffset + 0xD2);
        booRelativeAddr = 0x00100000 + booRelativeAddr; // Going to be a subtraction.

        let booSpacesOffset = boardInfo.spaceEventsStartOffset
          - (boardInfo.spaceEventsStartAddr - booRelativeAddr);

        for (let i = 0; i < booCount; i++) {
          let booSpace = (booSpaces[i] === undefined ? board._deadSpace : booSpaces[i]);
          boardView.setUint16(booSpacesOffset + (2 * i), booSpace);
        }
      }
      else if (boardInfo.booSpaceInst) { // Just one Boo
        let booSpace = (booSpaces[0] === undefined ? board._deadSpace : booSpaces[0]);
        boardView.setUint16(boardInfo.booSpaceInst + 2, booSpaces[0]);
      }
      else if (boardInfo.booCount) {
        for (let b = 0; b < boardInfo.booArrOffset.length; b++) {
          let curBooSpaceIndexOffset = boardInfo.booArrOffset[b];
          for (let i = 0; i < boardInfo.booCount; i++) {
            let booSpace = booSpaces[i] === undefined ? board._deadSpace : booSpaces[i];
            boardView.setUint16(curBooSpaceIndexOffset, booSpace);
            curBooSpaceIndexOffset += 2;
          }
        }
      }
    }

    _extractBanks(board, boardInfo) {
      if (!boardInfo.bankCount)
        return;

      let boardView = PP64.romhandler.getDataView();
      for (let b = 0; b < boardInfo.bankArrOffset.length; b++) {
        let curBankSpaceIndexOffset = boardInfo.bankArrOffset[b];
        for (let i = 0; i < boardInfo.bankCount; i++) {
          let bankSpace = boardView.getUint16(curBankSpaceIndexOffset);
          if (board.spaces[bankSpace])
            board.spaces[bankSpace].subtype = $spaceSubType.BANK;
          curBankSpaceIndexOffset += 2;
        }
      }
      for (let b = 0; b < boardInfo.bankCoinArrOffset.length; b++) {
        let curBankCoinSpaceIndexOffset = boardInfo.bankCoinArrOffset[b];
        for (let i = 0; i < boardInfo.bankCount; i++) {
          let bankCoinSpace = boardView.getUint16(curBankCoinSpaceIndexOffset);
          if (board.spaces[bankCoinSpace])
            board.spaces[bankCoinSpace].subtype = $spaceSubType.BANKCOIN;
          curBankCoinSpaceIndexOffset += 2;
        }
      }
    }

    _writeBanks(board, boardInfo) {
      let boardView = PP64.romhandler.getDataView();
      if (!boardInfo.bankCount)
        return;

      let bankSpaces = PP64.boards.getSpacesOfSubType($spaceSubType.BANK, board);
      for (let b = 0; b < boardInfo.bankArrOffset.length; b++) {
        let curBankSpaceIndexOffset = boardInfo.bankArrOffset[b];
        for (let i = 0; i < boardInfo.bankCount; i++) {
          let bankSpace = bankSpaces[i] === undefined ? board._deadSpace : bankSpaces[i];
          boardView.setUint16(curBankSpaceIndexOffset, bankSpace);
          curBankSpaceIndexOffset += 2;
        }
      }

      let bankCoinSpaces = PP64.boards.getSpacesOfSubType($spaceSubType.BANKCOIN, board);
      for (let b = 0; b < boardInfo.bankCoinArrOffset.length; b++) {
        let curBankCoinSpaceIndexOffset = boardInfo.bankCoinArrOffset[b];
        for (let i = 0; i < boardInfo.bankCount; i++) {
          let bankCoinSpace = bankCoinSpaces[i] === undefined ? board._deadSpace : bankCoinSpaces[i];
          boardView.setUint16(curBankCoinSpaceIndexOffset, bankCoinSpace);
          curBankCoinSpaceIndexOffset += 2;
        }
      }
    }

    _extractItemShops(board, boardInfo) {
      if (!boardInfo.itemShopCount)
        return;

      let boardView = PP64.romhandler.getDataView();
      for (let b = 0; b < boardInfo.itemShopArrOffset.length; b++) {
        let curItemShopSpaceIndexOffset = boardInfo.itemShopArrOffset[b];
        for (let i = 0; i < boardInfo.itemShopCount; i++) {
          let itemShopSpace = boardView.getUint16(curItemShopSpaceIndexOffset);
          if (board.spaces[itemShopSpace])
            board.spaces[itemShopSpace].subtype = $spaceSubType.ITEMSHOP;
          curItemShopSpaceIndexOffset += 2;
        }
      }
    }

    _writeItemShops(board, boardInfo) {
      let boardView = PP64.romhandler.getDataView();
      if (!boardInfo.itemShopCount)
        return;

      let itemShopSpaces = PP64.boards.getSpacesOfSubType($spaceSubType.ITEMSHOP, board);
      for (let b = 0; b < boardInfo.itemShopArrOffset.length; b++) {
        let curItemShopSpaceIndexOffset = boardInfo.itemShopArrOffset[b];
        for (let i = 0; i < boardInfo.itemShopCount; i++) {
          let ItemShopSpace = itemShopSpaces[i] === undefined ? board._deadSpace : itemShopSpaces[i];
          boardView.setUint16(curItemShopSpaceIndexOffset, ItemShopSpace);
          curItemShopSpaceIndexOffset += 2;
        }
      }
    }

    _writeBackground(bgIndex, src, width, height) {
      return new Promise((resolve, reject) => {
        // We need to write the image onto a canvas to get the RGBA32 values.
        let canvasCtx = PP64.utils.canvas.createContext(width, height);
        let srcImage = new Image();
        let failTimer = setTimeout(() => reject(`Failed to write bg ${bgIndex}`), 45000);
        srcImage.onload = () => {
          canvasCtx.drawImage(srcImage, 0, 0, width, height);

          let imgData = canvasCtx.getImageData(0, 0, width, height);
          PP64.adapters.hvqfs.writeBackground(bgIndex, imgData, width, height);
          clearTimeout(failTimer);
          resolve();
        };
        srcImage.src = src;
      });
    }

    onParseBoardSelectImg(board, boardInfo) {
      $$log("Adapter does not implement onParseBoardSelectImg");
    }

    onWriteBoardSelectImg(board, boardInfo) {
      $$log("Adapter does not implement onWriteBoardSelectImg");
      return new Promise((resolve, reject) => {
        resolve();
      });
    }

    onParseBoardLogoImg(board, boardInfo) {
      $$log("Adapter does not implement onParseBoardLogoImg");
    }

    onWriteBoardLogoImg(board, boardInfo) {
      $$log("Adapter does not implement onWriteBoardLogoImgs");
      return new Promise((resolve, reject) => {
        resolve();
      });
    }

    _brandBootSplashscreen() {
      return new Promise((resolve, reject) => {
        if (!PP64.settings.get($setting.writeBranding)) {
          resolve();
          return;
        }

        if (!this.nintendoLogoFSEntry || !this.hudsonLogoFSEntry) {
          $$log("Adapter cannot write branding");
          resolve();
          return;
        }

        let srcImage = new Image();
        let failTimer = setTimeout(() => reject(`Failed to overwrite boot logo`), 45000);
        srcImage.onload = () => {
          this._combineSplashcreenLogos();

          let pp64Splash32Buffer = PP64.utils.img.toArrayBuffer(srcImage, 320, 240);
          let pp64Splash16Buffer = PP64.utils.img.RGBA5551.fromRGBA32(pp64Splash32Buffer, 320, 240);

          // Then, pack the image and write it.
          let imgInfoArr = [
            {
              src: pp64Splash16Buffer,
              width: 320,
              height: 240,
              bpp: 16,
            }
          ];
          let newPack = PP64.utils.img.ImgPack.toPack(imgInfoArr, 16, 8);
          //saveAs(new Blob([newPack]));
          PP64.adapters.mainfs.write(this.hudsonLogoFSEntry[0], this.hudsonLogoFSEntry[1], newPack);

          clearTimeout(failTimer);
          resolve();
        };
        srcImage.src = "img/bootsplash.png";
      });
    }

    _combineSplashcreenLogos() {
      let nintendoPack = PP64.adapters.mainfs.get(this.nintendoLogoFSEntry[0], this.nintendoLogoFSEntry[1]); // (NINTENDO) logo
      if ((new Uint8Array(nintendoPack))[0x1A] !== 0x20)
        return; // We already replaced the splashscreen.

      let hudsonPack = PP64.adapters.mainfs.get(this.hudsonLogoFSEntry[0], this.hudsonLogoFSEntry[1]); // Hudson logo

      let nintendoImgInfo = PP64.utils.img.ImgPack.fromPack(nintendoPack)[0];
      let hudsonImgInfo = PP64.utils.img.ImgPack.fromPack(hudsonPack)[0];

      let nintendoArr = new Uint8Array(nintendoImgInfo.src);
      let hudsonArr = new Uint8Array(hudsonImgInfo.src);

      let comboCanvasCtx = PP64.utils.canvas.createContext(320, 240);
      comboCanvasCtx.fillStyle = "black";
      comboCanvasCtx.fillRect(0, 0, 320, 240);
      let comboImageData = comboCanvasCtx.getImageData(0, 0, 320, 240);

      for (let i = (320 * 88 * 4); i < (320 * 154 * 4); i++) {
        comboImageData.data[i - (320 * 40 * 4)] = nintendoArr[i];
      }
      for (let i = (320 * 88 * 4); i < (320 * 154 * 4); i++) {
        comboImageData.data[i + (320 * 50 * 4)] = hudsonArr[i];
      }

      //comboCanvasCtx.putImageData(comboImageData, 0, 0);
      //$$log(comboCanvasCtx.canvas.toDataURL());

      let combo16Buffer = PP64.utils.img.RGBA5551.fromRGBA32(comboImageData.data.buffer, 320, 240);
      let imgInfoArr = [
        {
          src: combo16Buffer,
          width: 320,
          height: 240,
          bpp: 16,
        }
      ];
      let newPack = PP64.utils.img.ImgPack.toPack(imgInfoArr, 16, 8);
      //saveAs(new Blob([newPack]));
      PP64.adapters.mainfs.write(this.nintendoLogoFSEntry[0], this.nintendoLogoFSEntry[1], newPack);
    }

    _clearOtherBoardNames(boardIndex) {
      $$log("Adapter does not implement _clearOtherBoardNames");
    }

    _readPackedFromMainFS(dir, file) {
      let imgPackBuffer = PP64.adapters.mainfs.get(dir, file);
      let imgArr = PP64.utils.img.ImgPack.fromPack(imgPackBuffer);
      if (!imgArr || !imgArr.length)
        return;

      let dataViews = imgArr.map(imgInfo => {
        return new DataView(imgInfo.src);
      });

      return dataViews;
    }

    _readImgsFromMainFS(dir, file) {
      let imgPackBuffer = PP64.adapters.mainfs.get(dir, file);
      let imgArr = PP64.utils.img.ImgPack.fromPack(imgPackBuffer);
      if (!imgArr || !imgArr.length)
        return;

      return imgArr;
    }

    _readImgInfoFromMainFS(dir, file, imgArrIndex) {
      let imgPackBuffer = PP64.adapters.mainfs.get(dir, file);
      let imgArr = this._readImgsFromMainFS(dir, file);

      imgArrIndex = imgArrIndex || 0;
      return imgArr[imgArrIndex];
    }

    _readImgFromMainFS(dir, file, imgArrIndex) {
      let imgInfo = this._readImgInfoFromMainFS(dir, file, imgArrIndex);
      return PP64.utils.arrays.arrayBufferToDataURL(imgInfo.src, imgInfo.width, imgInfo.height);
    }

    _parseAudio(board, boardInfo) {
      if (!boardInfo.audioIndexOffset)
        return;

      let boardView = PP64.romhandler.getDataView();
      board.audioIndex = boardView.getUint16(boardInfo.audioIndexOffset);
    }

    onWriteAudio(board, boardInfo, boardIndex) {
      if (!boardInfo.audioIndexOffset)
        return;

      let boardView = PP64.romhandler.getDataView();
      let index = board.audioIndex;
      boardView.setUint16(boardInfo.audioIndexOffset, index);
    }

    getAudioMap() {
      $$log("Adapter does not implement getAudioMap");
      return [];
    }

    getCharacterMap() {
      $$log("Adapter does not implement getCharacterMap");
      return {};
    }

    // For debug
    _debugBoardGameCoordsCycle(boardIndex) {
      let board = PP64.boards.getCurrentBoard();
      this._applyPerspective(board, boardIndex);
      this._reversePerspective(board, boardIndex);
      PP64.renderer.render();
    }
  };

  return {
    AdapterBase,

    getROMAdapter: function() {
        let game = PP64.romhandler.getGameVersion();
        if (!game)
          return null;

        return PP64.adapters.getAdapter(game);
    },

    getAdapter: function(game) {
      switch(game) {
        case 1:
          return PP64.adapters.MP1;
        case 2:
          return PP64.adapters.MP2;
        case 3:
          return PP64.adapters.MP3;
      }

      return null;
    }
  };
})();