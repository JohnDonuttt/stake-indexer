import { parseAbi } from "viem";

// only the events we index; keep in sync with StakingRewards.sol
export const stakingAbi = parseAbi([
  "event Staked(address indexed user, uint256 amount)",
  "event Withdrawn(address indexed user, uint256 amount)",
  "event RewardPaid(address indexed user, uint256 reward)",
  "event RewardAdded(uint256 reward, uint256 duration)",
]);
