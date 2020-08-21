import IMemory from 'modloader64_api/IMemory';
import { VANILLA_DUNGEON_ITEM_INDEXES } from './MMAPI';
import { IDungeonItemManager } from './IDungeonItemManager';
import { IDungeonItemContainer } from './IDungeonItemContainer';

export class DungeonItemManager implements IDungeonItemManager {
  emulator: IMemory;
  WOODFALL_TEMPLE: IDungeonItemContainer;
  SNOWHEAD_TEMPLE: IDungeonItemContainer;
  GREAT_BAY_TEMPLE: IDungeonItemContainer;
  STONE_TOWER_TEMPLE: IDungeonItemContainer;

  constructor(emulator: IMemory) {
      this.emulator = emulator;
      this.WOODFALL_TEMPLE = new DungeonItemContainer(
          this.emulator,
          VANILLA_DUNGEON_ITEM_INDEXES.WOODFALL_TEMPLE
      );
      this.SNOWHEAD_TEMPLE = new DungeonItemContainer(
          this.emulator,
          VANILLA_DUNGEON_ITEM_INDEXES.SNOWHEAD_TEMPLE
      );
      this.GREAT_BAY_TEMPLE = new DungeonItemContainer(
          this.emulator,
          VANILLA_DUNGEON_ITEM_INDEXES.GREAT_BAY_TEMPLE
      );
      this.STONE_TOWER_TEMPLE = new DungeonItemContainer(
          this.emulator,
          VANILLA_DUNGEON_ITEM_INDEXES.STONE_TOWER_TEMPLE
      );
  }
}

export class DungeonItemContainer implements IDungeonItemContainer {
  private addr: number = global.ModLoader.save_context + 0xa8;
  private emulator: IMemory;
  private index: number;

  constructor(emulator: IMemory, index: number) {
      this.emulator = emulator;
      this.index = index;
  }

  get bossKey(): boolean {
      return this.emulator.rdramReadBit8(this.addr + this.index, 7);
  }

  set bossKey(bool: boolean) {
      this.emulator.rdramWriteBit8(this.addr + this.index, 7, bool);
  }

  get compass(): boolean {
      return this.emulator.rdramReadBit8(this.addr + this.index, 6);
  }

  set compass(bool: boolean) {
      this.emulator.rdramWriteBit8(this.addr + this.index, 6, bool);
  }

  get map(): boolean {
      return this.emulator.rdramReadBit8(this.addr + this.index, 5);
  }

  set map(bool: boolean) {
      this.emulator.rdramWriteBit8(this.addr + this.index, 5, bool);
  }
}