import { InjectCore } from 'modloader64_api/CoreInjection';
import { bus, EventHandler, EventsClient, EventsServer, EventServerLeft } from 'modloader64_api/EventHandler';
import { INetworkPlayer, LobbyData, NetworkHandler, IPacketHeader } from 'modloader64_api/NetworkHandler';
import { MMOnlineEvents, MMOnline_PlayerScene } from './MMOAPI/MMOAPI';
import { createEquipmentFromContext, createInventoryFromContext, createQuestSaveFromContext, mergeEquipmentData, mergeInventoryData, mergeQuestSaveData, createDungeonItemDataFromContext, mergeDungeonItemData, InventorySave, applyInventoryToContext, applyEquipmentToContext, applyQuestSaveToContext, applyDungeonItemDataToContext, EquipmentSave, QuestSave, MMODungeonItemContext, IDungeonItemSave, MMO_SceneStruct } from './data/MMOSaveData';
import { MMO_ClientFlagUpdate, MMO_ClientSceneContextUpdate, MMO_DownloadRequestPacket, MMO_BottleUpdatePacket, MMO_SceneGUIPacket, MMO_BankSyncPacket, MMO_ScenePacket, MMO_SceneRequestPacket, MMO_DownloadResponsePacket2, MMO_ServerFlagUpdate, MMO_SubscreenSyncPacket, MMO_DownloadResponsePacket } from './data/MMOPackets';
import path from 'path';
import { GUITunnelPacket } from 'modloader64_api/GUITunnel';
import fs from 'fs';
import { MMOnlineStorageClient } from './MMOnlineStorageClient';
import { DiscordStatus } from 'modloader64_api/Discord';
import { ModLoaderAPIInject } from 'modloader64_api/ModLoaderAPIInjector';
import { Init, Preinit, Postinit, onTick } from 'modloader64_api/PluginLifecycle';
import { IModLoaderAPI, ModLoaderEvents } from 'modloader64_api/IModLoaderAPI';
import { SidedProxy, ProxySide } from 'modloader64_api/SidedProxy/SidedProxy';
import { parseFlagChanges } from './data/ParseFlagChanges';
import MMOnline, { IMMOnlineLobbyConfig, MMOnlineConfigCategory } from './MMOnline';
import { PuppetOverlordClient } from './data/linkPuppet/PuppetOverlord';
import { MMOnlineStorage } from './MMOnlineStorage';
import Vector3 from 'modloader64_api/math/Vector3';
import * as API from 'MajorasMask/API/Imports';


export let GHOST_MODE_TRIGGERED: boolean = false;

export class MMOnlineClient {
    
    @InjectCore()
    core!: API.IMMCore;
    
    @ModLoaderAPIInject()
    ModLoader!: IModLoaderAPI;

    parent!: MMOnline;
    LobbyConfig: IMMOnlineLobbyConfig = {} as IMMOnlineLobbyConfig;
    clientStorage: MMOnlineStorageClient = new MMOnlineStorageClient();
    config!: MMOnlineConfigCategory;

    @SidedProxy(ProxySide.CLIENT, PuppetOverlordClient)
    puppets!: PuppetOverlordClient;
    
    //@SidedProxy(ProxySide.CLIENT, ModelManagerClient)
    //modelManager!: ModelManagerClient;
    //@SidedProxy(ProxySide.CLIENT, UtilityActorHelper)
    //utility!: UtilityActorHelper;
    //@SidedProxy(ProxySide.CLIENT, ActorHookingManagerClient)
    //actorHooks!: ActorHookingManagerClient;
    //@SidedProxy(ProxySide.CLIENT, KeyLogManagerClient)
    //keys!: KeyLogManagerClient;
    
    //@SidedProxy(ProxySide.CLIENT, RPCClient)
    //rcp!: RPCClient;

    @EventHandler(MMOnlineEvents.GHOST_MODE)
    onGhostInstruction(evt: any) {
        this.clientStorage.first_time_sync = true;
        GHOST_MODE_TRIGGERED = true;
    }

    @Preinit()
    preinit() 
    {
        this.config = this.ModLoader.config.registerConfigCategory("MMOnline") as MMOnlineConfigCategory;
    }

    @Init()
    init(): void {}

    @Postinit()
    postinit() {
        this.clientStorage.scene_keys = JSON.parse(fs.readFileSync(__dirname + '/data/scene_numbers.json').toString());
        this.clientStorage.localization = JSON.parse(fs.readFileSync(__dirname + '/data/en_US.json').toString());
        let status: DiscordStatus = new DiscordStatus('Playing MMOnline', 'On the title screen');
        status.smallImageKey = 'MMO';
        status.partyId = this.ModLoader.clientLobby;
        status.partyMax = 30;
        status.partySize = 1;
        this.ModLoader.gui.setDiscordStatus(status);
    }

    updateInventory() {
        this.ModLoader.logger.info('updateInventory()');
        let inventory = createInventoryFromContext(this.core.save);
        let equipment = createEquipmentFromContext(this.core.save);
        let quest = createQuestSaveFromContext(this.core.save);
        let di = createDungeonItemDataFromContext(this.core.save.dungeonItemManager);

        mergeInventoryData(this.clientStorage.inventoryStorage, inventory);
        mergeEquipmentData(this.clientStorage.equipmentStorage, equipment);
        mergeQuestSaveData(this.clientStorage.questStorage, quest);
        mergeDungeonItemData(this.clientStorage.dungeonItemStorage, di);
        this.ModLoader.clientSide.sendPacket(new MMO_SubscreenSyncPacket(this.clientStorage.inventoryStorage, this.clientStorage.equipmentStorage, this.clientStorage.questStorage, this.clientStorage.dungeonItemStorage, this.ModLoader.clientLobby));
        
        this.clientStorage.needs_update = false;
    }

    updateFlags() {
        if (this.ModLoader.emulator.rdramRead8(0x80600144) === 0x1) {
            this.ModLoader.logger.debug("Flag updating temporarily disabled in this scene.");
            return;
        }

        this.ModLoader.utils.clearBuffer(this.clientStorage.sceneStorage);
        this.ModLoader.utils.clearBuffer(this.clientStorage.eventStorage);
        this.ModLoader.utils.clearBuffer(this.clientStorage.itemFlagStorage);
        this.ModLoader.utils.clearBuffer(this.clientStorage.infStorage);
        this.ModLoader.utils.clearBuffer(this.clientStorage.skulltulaStorage);

        let scene_data = this.core.save.scene_flags;
        let event_data = this.core.save.eventFlags;
        let scenes: any = parseFlagChanges(scene_data, this.clientStorage.sceneStorage);
        let events: any = parseFlagChanges(event_data, this.clientStorage.eventStorage);

        this.ModLoader.logger.info('updateFlags()');
        this.ModLoader.clientSide.sendPacket(new MMO_ClientFlagUpdate(this.clientStorage.sceneStorage, this.clientStorage.eventStorage, this.clientStorage.itemFlagStorage, this.clientStorage.infStorage, this.clientStorage.skulltulaStorage, this.ModLoader.clientLobby));
    }

    autosaveSceneData() {
        if (!this.core.helper.isLinkEnteringLoadingZone() && this.core.global.scene_framecount > 20) {
            if (this.ModLoader.emulator.rdramRead8(0x80600144) === 0x1) return;

            let live_scene_chests: Buffer = this.core.global.liveSceneData_chests;
            let live_scene_switches: Buffer = this.core.global.liveSceneData_switch;
            let live_scene_clear: Buffer = this.core.global.liveSceneData_clear;
            let live_scene_temp: Buffer = this.core.global.liveSceneData_temp;
            let save_scene_data: Buffer = this.core.global.getSaveDataForCurrentScene();
            let save: Buffer = Buffer.alloc(0x1c);

            live_scene_chests.copy(save, 0x0); // Chests
            live_scene_switches.copy(save, 0x4); // Switches
            live_scene_clear.copy(save, 0x8); // Room Clear
            live_scene_temp.copy(save, 0x10); // Unused space.
            save_scene_data.copy(save, 0x14, 0x14, 0x18); // Visited Rooms.
            save_scene_data.copy(save, 0x18, 0x18, 0x1c); // Visited Rooms.

            let save_hash_2: string = this.ModLoader.utils.hashBuffer(save);

            if (save_hash_2 !== this.clientStorage.autoSaveHash) {
                this.ModLoader.logger.info('autosaveSceneData()');
                save_scene_data.copy(save, 0x10, 0x10, 0x14);
                for (let i = 0; i < save_scene_data.byteLength; i++) {
                    save_scene_data[i] |= save[i];
                }

                this.clientStorage.autoSaveHash = save_hash_2;
            }
            else return;

            this.core.global.writeSaveDataForCurrentScene(save_scene_data);
            this.ModLoader.clientSide.sendPacket(new MMO_ClientSceneContextUpdate(live_scene_chests, live_scene_switches, live_scene_clear, live_scene_temp, this.ModLoader.clientLobby, this.core.global.current_scene));
        }
    }

    updateBottles(onlyfillCache = false) {
        let bottles: API.InventoryItem[] = [
            this.core.save.inventory.FIELD_BOTTLE1,
            this.core.save.inventory.FIELD_BOTTLE2,
            this.core.save.inventory.FIELD_BOTTLE3,
            this.core.save.inventory.FIELD_BOTTLE4,
            this.core.save.inventory.FIELD_BOTTLE5,
            this.core.save.inventory.FIELD_BOTTLE6
        ];

        for (let i = 0; i < bottles.length; i++) {
            if (bottles[i] !== this.clientStorage.bottleCache[i]) {
                this.clientStorage.bottleCache[i] = bottles[i];
                this.ModLoader.logger.info('Bottle update.');

                if (!onlyfillCache) this.ModLoader.clientSide.sendPacket(new MMO_BottleUpdatePacket(i, bottles[i], this.ModLoader.clientLobby));
            }
        }
    }

    /*updateSkulltulas() {
        if (this.clientStorage.lastKnownSkullCount <
            this.core.save.questStatus.goldSkulltulas) {
            this.clientStorage.needs_update = true;
            this.clientStorage.lastKnownSkullCount = this.core.save.questStatus.goldSkulltulas;
            this.ModLoader.logger.info('Skulltula update.');
            this.updateFlags();
        }
    }*/

    @EventHandler(API.MMEvents.ON_SAVE_LOADED)
    onSaveLoaded(evt: any) {
        setTimeout(() => {
            if (this.LobbyConfig.data_syncing) this.ModLoader.clientSide.sendPacket(new MMO_DownloadRequestPacket(this.ModLoader.clientLobby));

            let gui_p: MMO_SceneGUIPacket = new MMO_SceneGUIPacket(this.core.global.current_scene, this.core.save.form, this.ModLoader.clientLobby);
            
            /*if (this.modelManager.clientStorage.adultIcon.byteLength > 1) {
                gui_p.setAdultIcon(this.modelManager.clientStorage.adultIcon);
            }

            if (this.modelManager.clientStorage.childIcon.byteLength > 1) {
                gui_p.setChildIcon(this.modelManager.clientStorage.childIcon);
            }*/

            this.ModLoader.gui.tunnel.send('MMOnline:onAgeChange', new GUITunnelPacket('MMOnline', 'MMOnline:onAgeChange', gui_p));
        }, 1000);
    }
    
   
    //------------------------------
    // Lobby Setup
    //------------------------------
    @EventHandler(EventsClient.CONFIGURE_LOBBY)
    onLobbySetup(lobby: LobbyData): void {
        lobby.data['MMOnline:data_syncing'] = true;
        lobby.data['MMOnline:actor_syncing'] = true;
        //lobby.data['MMOnline:key_syncing'] = this.config.keySync;
    }

    @EventHandler(EventsClient.ON_LOBBY_JOIN)
    onJoinedLobby(lobby: LobbyData): void {
        this.LobbyConfig.actor_syncing = lobby.data['MMOnline:actor_syncing'];
        this.LobbyConfig.data_syncing = lobby.data['MMOnline:data_syncing'];
        this.LobbyConfig.key_syncing = lobby.data['MMOnline:key_syncing'];
        this.ModLoader.logger.info('MMOnline settings inherited from lobby.');

        if (GHOST_MODE_TRIGGERED) bus.emit(MMOnlineEvents.GHOST_MODE, true);
    }

    @EventHandler(EventsClient.ON_PLAYER_LEAVE)
    onPlayerLeft(player: INetworkPlayer) {
        this.ModLoader.gui.tunnel.send('MMOnline:onPlayerLeft', new GUITunnelPacket('MMOnline', 'MMOnline:onPlayerLeft', player));
    }

    @EventHandler(EventsServer.ON_LOBBY_LEAVE)
    onPlayerLeft_server(evt: EventServerLeft) {
        let storage: MMOnlineStorage = this.ModLoader.lobbyManager.getLobbyStorage(evt.lobby, this) as MMOnlineStorage;
        
        if (storage === null) return;
        
        delete storage.players[evt.player.uuid];
        delete storage.networkPlayerInstances[evt.player.uuid];
    }


    @EventHandler(EventsServer.ON_LOBBY_CREATE)
    onLobbyCreated(lobby: string) {
        try {
            this.ModLoader.lobbyManager.createLobbyStorage(
                lobby,
                this,
                new MMOnlineStorage()
            );
        } catch (err) {
            this.ModLoader.logger.error(err);
        }
    }

    //------------------------------
    // Scene handling
    //------------------------------

    @EventHandler(API.MMEvents.ON_ROOM_CHANGE)
    onRoomChange(room: number) {
        this.ModLoader.gui.tunnel.send('MMOnline:onRoomChanged', new GUITunnelPacket('MMOnline', 'MMOnline:onRoomChanged', room));
    }

    @EventHandler(API.MMEvents.ON_LOADING_ZONE)
    onLoadingZone(evt: any) {
        this.ModLoader.logger.debug("I've touched a loading zone.");
    }

    @NetworkHandler('MMO_ScenePacket')
    onSceneChange_client(packet: MMO_ScenePacket) {
        this.ModLoader.logger.info(
            'client receive: Player ' + packet.player.nickname
            + ' moved to scene ' + this.clientStorage.localization[this.clientStorage.scene_keys[packet.scene]] + '.'
        );

        this.ModLoader.logger.info(
            'Current Scene Test:' + this.core.global.current_scene + '.'
        );

        bus.emit(MMOnlineEvents.CLIENT_REMOTE_PLAYER_CHANGED_SCENES, new MMOnline_PlayerScene(packet.player, packet.lobby, packet.scene));

        let gui_p: MMO_SceneGUIPacket = new MMO_SceneGUIPacket(packet.scene, packet.form, packet.lobby);
        gui_p.player = packet.player;

        /*if (
            this.modelManager.clientStorage.playerModelCache.hasOwnProperty(
                packet.player.uuid
            )
        ) {
            if (
                (this.modelManager.clientStorage.playerModelCache[
                    packet.player.uuid
                ] as ModelPlayer).customIconAdult.byteLength > 1
            ) {
                gui_p.setAdultIcon(
                    (this.modelManager.clientStorage.playerModelCache[
                        packet.player.uuid
                    ] as ModelPlayer).customIconAdult
                );
            }
            if (
                (this.modelManager.clientStorage.playerModelCache[
                    packet.player.uuid
                ] as ModelPlayer).customIconChild.byteLength > 1
            ) {
                gui_p.setChildIcon(
                    (this.modelManager.clientStorage.playerModelCache[
                        packet.player.uuid
                    ] as ModelPlayer).customIconChild
                );
            }
        }*/

        this.ModLoader.gui.tunnel.send('MMOnline:onSceneChanged_Network',
            new GUITunnelPacket(
                'MMOnline',
                'MMOnline:onSceneChanged_Network',
                gui_p
            )
        );
    }

    // This packet is basically 'where the hell are you?' if a player has a puppet on file but doesn't know what scene its suppose to be in.
    @NetworkHandler('MMO_SceneRequestPacket')
    onSceneRequest_client(packet: MMO_SceneRequestPacket) {
        if (this.core.save !== undefined) {
            this.ModLoader.clientSide.sendPacketToSpecificPlayer(
                new MMO_ScenePacket(
                    this.ModLoader.clientLobby,
                    this.core.global.scene_framecount,
                    this.core.save.form
                ),
                packet.player
            );
        }
    }

    @EventHandler(API.MMEvents.ON_SCENE_CHANGE)
    onSceneChange(scene: number) {
        this.ModLoader.logger.debug(scene.toString(16));
        this.ModLoader.clientSide.sendPacket(
            new MMO_ScenePacket(
                this.ModLoader.clientLobby,
                scene,
                this.core.save.form
            )
        );
    }

    @EventHandler(API.MMEvents.ON_AGE_CHANGE)
    onAgeChange(age: API.MMForms) {
        this.ModLoader.clientSide.sendPacket(
            new MMO_ScenePacket(
                this.ModLoader.clientLobby,
                this.core.global.current_scene,
                age
            )
        );
    }

    @NetworkHandler('MMO_BottleUpdatePacket')
    onBottle_client(packet: MMO_BottleUpdatePacket) {
        if (this.core.helper.isTitleScreen() || !this.core.helper.isSceneNumberValid()) return;

        this.clientStorage.bottleCache[packet.slot] = packet.contents;
        let inventory: InventorySave = createInventoryFromContext(this.core.save) as InventorySave;

        switch (packet.slot) {
            case 0:
                inventory.FIELD_BOTTLE1 = packet.contents;
                break;
            case 1:
                inventory.FIELD_BOTTLE2 = packet.contents;
                break;
            case 2:
                inventory.FIELD_BOTTLE3 = packet.contents;
                break;
            case 3:
                inventory.FIELD_BOTTLE4 = packet.contents;
                break;
            case 4:
                inventory.FIELD_BOTTLE5 = packet.contents;
                break;
            case 5:
                inventory.FIELD_BOTTLE6 = packet.contents;
                break;
        }

        mergeInventoryData(this.clientStorage.inventoryStorage, inventory);
        applyInventoryToContext(this.clientStorage.inventoryStorage, this.core.save, true);
        bus.emit(MMOnlineEvents.ON_INVENTORY_UPDATE, this.core.save.inventory);
    }

    // The server is giving me data.
    @NetworkHandler('MMO_DownloadResponsePacket')
    onDownloadPacket_client(packet: MMO_DownloadResponsePacket) {
        this.ModLoader.logger.info('Retrieving savegame from server...');

        // Clear inventory.
        this.ModLoader.emulator.rdramWriteBuffer(global.ModLoader.save_context + 0x0070, Buffer.alloc(0x18, 0xFF)); //TODO: Fix for MM

        // Clear c-button and b.
        this.ModLoader.emulator.rdramWriteBuffer(global.ModLoader.save_context + 0x0064, Buffer.alloc(0x4, 0xFF));

        //this.core.link.sword = Sword.NONE;
        //this.core.link.shield = Shield.NONE;
        applyInventoryToContext(packet.subscreen.inventory, this.core.save, true);
        applyEquipmentToContext(packet.subscreen.equipment, this.core.save);
        applyQuestSaveToContext(packet.subscreen.quest, this.core.save);
        applyDungeonItemDataToContext(
            packet.subscreen.dungeonItems,
            this.core.save.dungeonItemManager
        );

        this.core.save.permSceneData = packet.flags.scenes;
        this.core.save.eventFlags = packet.flags.events;
        this.core.save.itemFlags = packet.flags.items;
        this.core.save.infTable = packet.flags.inf;
        this.core.save.skulltulaFlags = packet.flags.skulltulas;

        this.clientStorage.bank = packet.bank.savings;
        this.ModLoader.emulator.rdramWrite16(0x8011B874, this.clientStorage.bank);
        this.clientStorage.first_time_sync = true;
    }

    // I am giving the server data.
    @NetworkHandler('MMO_DownloadResponsePacket2')
    onDownPacket2_client(packet: MMO_DownloadResponsePacket2) {
        this.clientStorage.first_time_sync = true;
        this.ModLoader.logger.info('The lobby is mine!');
        this.clientStorage.needs_update = true;
        this.updateBottles(true);
    }

    @NetworkHandler('MMO_SubscreenSyncPacket')
    onItemSync_client(packet: MMO_SubscreenSyncPacket) {
        if (this.core.helper.isTitleScreen() || !this.core.helper.isSceneNumberValid()) return;

        let inventory: InventorySave = createInventoryFromContext(this.core.save) as InventorySave;
        let equipment: EquipmentSave = createEquipmentFromContext(this.core.save) as EquipmentSave;
        let dungeonItems: MMODungeonItemContext = createDungeonItemDataFromContext(this.core.save.dungeonItemManager) as IDungeonItemSave;
        let quest: QuestSave = createQuestSaveFromContext(this.core.save);

        mergeInventoryData(this.clientStorage.inventoryStorage, inventory);
        mergeEquipmentData(this.clientStorage.equipmentStorage, equipment);
        mergeQuestSaveData(this.clientStorage.questStorage, quest);
        mergeDungeonItemData(this.clientStorage.dungeonItemStorage, dungeonItems);

        mergeInventoryData(this.clientStorage.inventoryStorage, packet.inventory);
        mergeEquipmentData(this.clientStorage.equipmentStorage, packet.equipment);
        mergeQuestSaveData(this.clientStorage.questStorage, packet.quest);
        mergeDungeonItemData(this.clientStorage.dungeonItemStorage, packet.dungeonItems);

        applyInventoryToContext(this.clientStorage.inventoryStorage, this.core.save);
        applyEquipmentToContext(this.clientStorage.equipmentStorage, this.core.save);
        applyQuestSaveToContext(this.clientStorage.questStorage, this.core.save);
        applyDungeonItemDataToContext(this.clientStorage.dungeonItemStorage, this.core.save.dungeonItemManager);

        this.ModLoader.gui.tunnel.send('MMOnline:onSubscreenPacket', new GUITunnelPacket('MMOnline', 'MMOnline:onSubscreenPacket', packet));
    }

    @NetworkHandler('MMO_ServerFlagUpdate')
    onSceneFlagSync_client(packet: MMO_ServerFlagUpdate) {
        this.ModLoader.utils.clearBuffer(this.clientStorage.sceneStorage);
        this.ModLoader.utils.clearBuffer(this.clientStorage.eventStorage);
        this.ModLoader.utils.clearBuffer(this.clientStorage.itemFlagStorage);
        this.ModLoader.utils.clearBuffer(this.clientStorage.infStorage);
        this.ModLoader.utils.clearBuffer(this.clientStorage.skulltulaStorage);

        let scene_data = this.core.save.permSceneData;
        let event_data = this.core.save.eventFlags;
        let item_data = this.core.save.itemFlags;
        let inf_data = this.core.save.infTable;
        let skulltula_data = this.core.save.skulltulaFlags;

        parseFlagChanges(scene_data, this.clientStorage.sceneStorage);
        parseFlagChanges(event_data, this.clientStorage.eventStorage);
        parseFlagChanges(item_data, this.clientStorage.itemFlagStorage);
        parseFlagChanges(inf_data, this.clientStorage.infStorage);
        parseFlagChanges(skulltula_data, this.clientStorage.skulltulaStorage);

        for (let i = 0; i < packet.scenes.byteLength; i += 0x1C) {
            let struct = new MMO_SceneStruct(packet.scenes.slice(i, i + 0x1C));
            let cur = new MMO_SceneStruct(this.clientStorage.sceneStorage.slice(i, i + 0x1C));

            for (let j = 0; j < struct.chests.byteLength; j++) {
                if (struct.chests[j] !== cur.chests[i]) cur.chests[j] |= struct.chests[j];
            }

            for (let j = 0; j < struct.collectible.byteLength; j++) {
                if (struct.collectible[j] !== cur.collectible[i]) cur.collectible[j] |= struct.collectible[j];
            }

            for (let j = 0; j < struct.room_clear.byteLength; j++) {
                if (struct.room_clear[j] !== cur.room_clear[i]) cur.room_clear[j] |= struct.room_clear[j];
            }

            for (let j = 0; j < struct.switches.byteLength; j++) {
                if (struct.switches[j] !== cur.switches[i]) cur.switches[j] |= struct.switches[j];
            }

            for (let j = 0; j < struct.visited_floors.byteLength; j++) {
                if (struct.visited_floors[j] !== cur.visited_floors[i]) cur.visited_floors[j] |= struct.visited_floors[j];
            }

            for (let j = 0; j < struct.visited_rooms.byteLength; j++) {
                if (struct.visited_rooms[j] !== cur.visited_rooms[i]) cur.visited_rooms[j] |= struct.visited_rooms[j];
            }

            for (let j = 0; j < struct.unused.byteLength; j++) {
                if (struct.unused[j] !== cur.unused[i]) cur.unused[j] = struct.unused[j];
            }
        }

        for (let i = 0; i < packet.events.byteLength; i++) {
            let value = packet.events[i];
            if (this.clientStorage.eventStorage[i] !== value) this.clientStorage.eventStorage[i] |= value;
        }

        for (let i = 0; i < packet.items.byteLength; i++) {
            let value = packet.items[i];
            if (this.clientStorage.itemFlagStorage[i] !== value) this.clientStorage.itemFlagStorage[i] |= value;
        }

        for (let i = 0; i < packet.inf.byteLength; i++) {
            let value = packet.inf[i];
            if (this.clientStorage.infStorage[i] !== value) this.clientStorage.infStorage[i] |= value;
        }

        for (let i = 0; i < packet.skulltulas.byteLength; i++) {
            let value = packet.skulltulas[i];
            if (this.clientStorage.skulltulaStorage[i] !== value) this.clientStorage.skulltulaStorage[i] |= value;
        }

        this.core.save.permSceneData = this.clientStorage.sceneStorage;
        this.core.save.eventFlags = this.clientStorage.eventStorage;
        this.core.save.itemFlags = this.clientStorage.itemFlagStorage;
        this.core.save.infTable = this.clientStorage.infStorage;
        this.core.save.skulltulaFlags = this.clientStorage.skulltulaStorage;
    }

    @NetworkHandler('MMO_ClientSceneContextUpdate')
    onSceneContextSync_client(packet: MMO_ClientSceneContextUpdate) {
        if (this.core.helper.isTitleScreen() || !this.core.helper.isSceneNumberValid() || this.core.helper.isLinkEnteringLoadingZone()) {
            return;
        }

        if (this.core.global.current_scene !== packet.scene) return;
        
        let buf: Buffer = this.core.global.liveSceneData_chests;
        if (Object.keys(parseFlagChanges(packet.chests, buf) > 0)) this.core.global.liveSceneData_chests = buf;

        buf = this.core.global.liveSceneData_switch;
        if (Object.keys(parseFlagChanges(packet.switches, buf) > 0)) this.core.global.liveSceneData_switch = buf;

        //TODO: Find the collectable live data
        /*let buf3: Buffer = this.core.save.liveSceneData_collectable;
        if (Object.keys(parseFlagChanges(packet.collect, buf3) > 0)) {
            this.core.save.liveSceneData_collectable = buf3;
        }*/ 

        buf = this.core.global.liveSceneData_clear;
        if (Object.keys(parseFlagChanges(packet.clear, buf) > 0)) this.core.global.liveSceneData_clear = buf;

        buf = this.core.global.liveSceneData_temp;
        if (Object.keys(parseFlagChanges(packet.temp, buf) > 0)) this.core.global.liveSceneData_temp = buf;
    }

    @NetworkHandler("MMO_BankSyncPacket")
    onBankUpdate(packet: MMO_BankSyncPacket) {
        this.clientStorage.bank = packet.savings;
        this.ModLoader.emulator.rdramWrite16(0x8011B874, this.clientStorage.bank);
    }

    healPlayer() {
        if (this.core.helper.isTitleScreen() || !this.core.helper.isSceneNumberValid()) return;

        this.ModLoader.emulator.rdramWrite16(global.ModLoader.save_context + 0x36, 0x0140);
    }

    @EventHandler(MMOnlineEvents.GAINED_PIECE_OF_HEART)
    onNeedsHeal1(evt: any) {
        this.healPlayer();
    }

    @EventHandler(MMOnlineEvents.GAINED_HEART_CONTAINER)
    onNeedsHeal2(evt: any) {
        this.healPlayer();
    }

    @EventHandler(MMOnlineEvents.MAGIC_METER_INCREASED)
    onNeedsMagic(size: API.Magic) {
        switch (size) {
            case API.Magic.NONE:
                this.core.save.magic_current = API.MagicQuantities.NONE;
                break;
            case API.Magic.NORMAL:
                this.core.save.magic_current = API.MagicQuantities.NORMAL;
                break;
            case API.Magic.EXTENDED:
                this.core.save.magic_current = API.MagicQuantities.EXTENDED;
                break;
        }
    }

    @EventHandler(MMOnlineEvents.ON_INVENTORY_UPDATE)
    onInventoryUpdate(inventory: API.IInventory) {
        if (this.core.helper.isTitleScreen() || !this.core.helper.isSceneNumberValid()) return;

        let addr: number = global.ModLoader.save_context + 0x0064; //C-L, C-D, C-R
        let buf: Buffer = this.ModLoader.emulator.rdramReadBuffer(addr, 0x3);
        let addr2: number = global.ModLoader.save_context + 0x0070; //Inventory Items
        let raw_inventory: Buffer = this.ModLoader.emulator.rdramReadBuffer(addr2, 0x18);

        //TODO: Uh.. This seems to work differently in MM. This will need updating.
        if (buf[0x4] !== API.InventoryItem.NONE && raw_inventory[buf[0x4]] !== API.InventoryItem.NONE) {
            buf[0x1] = raw_inventory[buf[0x4]];
            this.ModLoader.emulator.rdramWriteBuffer(addr, buf);
            this.core.commandBuffer.runCommand(
                API.Command.UPDATE_C_BUTTON_ICON,
                0x00000001,
                (success: boolean, result: number) => { }
            );
        }

        if (buf[0x5] !== API.InventoryItem.NONE && raw_inventory[buf[0x5]] !== API.InventoryItem.NONE) {
            buf[0x2] = raw_inventory[buf[0x5]];
            this.ModLoader.emulator.rdramWriteBuffer(addr, buf);
            this.core.commandBuffer.runCommand(
                API.Command.UPDATE_C_BUTTON_ICON,
                0x00000002,
                (success: boolean, result: number) => { }
            );
        }

        if (buf[0x6] !== API.InventoryItem.NONE && raw_inventory[buf[0x6]] !== API.InventoryItem.NONE) {
            buf[0x3] = raw_inventory[buf[0x6]];
            this.ModLoader.emulator.rdramWriteBuffer(addr, buf);
            this.core.commandBuffer.runCommand(
                API.Command.UPDATE_C_BUTTON_ICON,
                0x00000003,
                (success: boolean, result: number) => { }
            );
        }
    }

    @EventHandler(ModLoaderEvents.ON_CRASH)
    /*onEmuCrash(evt: any) {
        fs.writeFileSync(
            './MMO_storagedump.json',
            JSON.stringify(this.clientStorage, null, 2)
        );
        this.utility.makeRamDump();
    }*/

    @EventHandler(EventsClient.ON_PAYLOAD_INJECTED)
    onPayload(evt: any) {
        let f = path.parse(evt.file);
        if (f.ext === ".ovl") {
            if (f.name === "link") {
                this.ModLoader.logger.info("Puppet assigned.");
                this.ModLoader.emulator.rdramWrite16(0x800000, evt.result);
                this.ModLoader.logger.debug('evt.result: ' + evt.result);
            }
        }
    }

    @EventHandler(EventsClient.ON_INJECT_FINISHED)
    onStartupFinished(evt: any) {
        //this.core.toggleMapSelectKeybind();
    }

    @EventHandler(ModLoaderEvents.ON_ROM_PATCHED)
    onRom(evt: any) {
        //TODO: DO RANDO CHECK FOR MM
        /*let expected_hash: string = "34c6b74de175cb3d5d08d8428e7ab21d";
        let tools: Z64RomTools = new Z64RomTools(this.ModLoader, 0x7430);
        let file_select_ovl: Buffer = tools.decompressFileFromRom(evt.rom, 32);
        let hash: string = this.ModLoader.utils.hashBuffer(file_select_ovl);
        if (expected_hash !== hash) {
            this.ModLoader.logger.info("File select overlay is modified. Is this rando?");
            this.ModLoader.clientSide.sendPacket(new MMO_isRandoPacket(this.ModLoader.clientLobby));
        }*/ 
    }

    @EventHandler(ModLoaderEvents.ON_SOFT_RESET_PRE)
    onReset(evt: any) {
        this.clientStorage.first_time_sync = false;
    }

    // This spawns the helper actor to fix some flag issues.
    @EventHandler(API.MMEvents.ON_ACTOR_SPAWN)
    /*onActorSpawned(actor: IActor) {
        // 0x87 = Forest Temple Elevator.
        // 0x102 = Windmill Blades.
        // 0xF8 = Hyrule Castle Gate.
        // 0xCB = Ingo.
        if (actor.actorID === 0x0087 || actor.actorID === 0x102 || actor.actorID === 0xF8 || (actor.actorID === 0xCB && actor.variable === 0x2)) {
            (this.clientStorage.overlayCache["flag_fixer.ovl"] as IOvlPayloadResult).spawn((this.clientStorage.overlayCache["flag_fixer.ovl"] as IOvlPayloadResult), (success: boolean, result: number) => {
                let ff: IActor = this.core.actorManager.createIActorFromPointer(result);
                if (actor.actorID === 0x0087) {
                    ff.rdramWriteBuffer(0x24, Buffer.from("433B788243690000C4BAC599", 'hex'));
                } else if (actor.actorID === 0x102) {
                    ff.rdramWriteBuffer(0x24, Buffer.from("43751CE2432000004436C483", 'hex'));
                } else if (actor.actorID === 0xF8) {
                    ff.rdramWriteBuffer(0x24, Buffer.from("44130FE344CA2000C39B683C", 'hex'));
                } else if (actor.actorID === 0xCB && actor.variable === 0x2) {
                    ff.rdramWriteBuffer(0x24, Buffer.from('C31E000000000000C4C78000', 'hex'));
                }
                this.ModLoader.logger.debug("Summoning the bugfix actor...");
                return {};
            });
        }
    }*/

    @onTick()
    onTick() {
        if (!this.core.helper.isTitleScreen() && this.core.helper.isSceneNumberValid() && this.core.helper.isInterfaceShown()) {
            if (!this.core.helper.isPaused()) {
                if (!this.clientStorage.first_time_sync) return;

                if (this.LobbyConfig.actor_syncing) {
                    //this.actorHooks.tick();
                }

                if (this.LobbyConfig.data_syncing) {
                    this.autosaveSceneData();
                    this.updateBottles();
                    //this.updateSkulltulas();

                    if (this.LobbyConfig.key_syncing) {
                        //this.keys.update();
                    }

                    let state = this.core.link.state;
                    if (state === API.LinkState.BUSY || state === API.LinkState.GETTING_ITEM || state === API.LinkState.TALKING) this.clientStorage.needs_update = true;
                    else if (state === API.LinkState.STANDING && this.clientStorage.needs_update && this.LobbyConfig.data_syncing) {
                        this.updateInventory();
                        this.updateFlags();
                        this.clientStorage.needs_update = false;
                    }
                }
            }
        }
    }
}